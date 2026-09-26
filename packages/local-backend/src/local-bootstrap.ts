import { randomBytes, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { EmbeddedDatabaseHandle } from "@maestro/persistence";
import type { ConnectionState } from "./connection.js";
import { ensureLocalControlPlane } from "./local-control-plane.js";
import { ensureLocalDatabase, makeLocalDataDirectories } from "./bootstrap/database.js";
import { resolveControlPlaneEntry } from "./bootstrap/entry.js";
import { runBootstrapHelper, validateLocalToken, waitForLocalControlPlane } from "./bootstrap/control-plane.js";
import { ensureLocalModelGatewayWithReporting } from "./bootstrap/gateway.js";
import {
  deriveModelGatewayToken,
  extractLocalSecret,
  extractUuidCredentialId,
  isCanonicalUuid,
  normalizeApiUrl,
  normalizeModelGatewayUrl,
} from "./bootstrap/identity.js";
import {
  abortableOperation,
  defaultRunCommand,
  defaultStartControlPlane,
  startOwnedProcessWithCancellation,
  throwIfAborted,
} from "./bootstrap/process.js";
import { createLocalSecretStore } from "./bootstrap/secret-store.js";
import { reportSetupStep } from "./bootstrap/steps.js";
import type { LocalBootstrapOptions, LocalCommandRunner, LocalProcessHandle } from "./bootstrap/types.js";

export {
  DEFAULT_LOCAL_API_URL,
  DEFAULT_LOCAL_DATABASE_URL,
  DOCKER_LOCAL_DATABASE_URL,
  LOCAL_POSTGRES_CONTAINER,
} from "./bootstrap/constants.js";
export type {
  LocalSecretStore,
  LocalCommandResult,
  LocalCommandRunner,
  LocalProcessHandle,
  LocalModelGatewayLaunchOptions,
  LocalControlPlaneLaunchOptions,
  LocalBootstrapOptions,
  LocalBootstrapStepName,
  LocalBootstrapStepStatus,
  LocalBootstrapStepEvent,
} from "./bootstrap/types.js";
export { LOCAL_BOOTSTRAP_STEP_ORDER } from "./bootstrap/types.js";
export { createLocalSecretStore } from "./bootstrap/secret-store.js";
export { configuredEmbeddedDatabasePort } from "./bootstrap/database.js";
export { resolveInstalledControlPlaneEntry, resolvePackagedAppEntry } from "./bootstrap/entry.js";
export { buildLocalModelGatewayEnvironment, buildLocalControlPlaneEnvironment, buildNodeChildEnvironment } from "./bootstrap/process.js";

/**
 * Resolve a local connection without putting a bearer secret in a file. The
 * first run creates the local operator through the Control Plane bootstrap
 * helper, then stores only the bearer in the platform keychain.
 */
export async function resolveLocalConnection(options: LocalBootstrapOptions): Promise<ConnectionState> {
  let stopOwnedProcesses: (() => Promise<void>) | undefined;
  try {
    return await resolveLocalConnectionInternal(options, (stop) => {
      stopOwnedProcesses = stop;
    });
  } finally {
    if (options.signal?.aborted) await stopOwnedProcesses?.();
  }
}

async function resolveLocalConnectionInternal(
  options: LocalBootstrapOptions,
  registerCleanup: (stop: () => Promise<void>) => void,
): Promise<ConnectionState> {
  throwIfAborted(options.signal);
  const apiUrl = normalizeApiUrl(options.env.MAESTRO_API_URL);
  let modelGatewayUrl: string;
  try {
    modelGatewayUrl = normalizeModelGatewayUrl(options.env.MAESTRO_MODEL_GATEWAY_URL);
  } catch (error) {
    return { kind: "setup-required", reason: error instanceof Error ? error.message : "MAESTRO_MODEL_GATEWAY_URL is invalid" };
  }
  const fetch = options.fetch ?? globalThis.fetch;
  const secretStore = options.secretStore ?? createLocalSecretStore();
  const commandRunner = options.runCommand ?? defaultRunCommand;
  const runCommand: LocalCommandRunner = (file, args, commandOptions) => {
    const effectiveOptions = options.signal === undefined ? commandOptions : { ...commandOptions, signal: options.signal };
    const operation = effectiveOptions === undefined ? commandRunner(file, args) : commandRunner(file, args, effectiveOptions);
    return abortableOperation(operation, options.signal);
  };
  const retryDelayMs = options.retryDelayMs ?? 500;
  let storedToken = secretStore.read();
  let bootstrapSecret: string | undefined;
  let bootstrapProjectId: string | undefined;
  const configuredOperatorId = options.env.MAESTRO_LOCAL_OPERATOR_ID?.trim();
  if (configuredOperatorId !== undefined && !isCanonicalUuid(configuredOperatorId)) {
    return { kind: "setup-required", reason: "MAESTRO_LOCAL_OPERATOR_ID must be a canonical UUID" };
  }
  const localOperatorId = configuredOperatorId || extractUuidCredentialId(storedToken) || randomUUID();
  let gatewayReady = false;
  let ownedGateway: LocalProcessHandle | undefined;
  let ownedControlPlane: LocalProcessHandle | undefined;
  let ownedDatabase: EmbeddedDatabaseHandle | undefined;
  const stopOwnedProcesses = async (): Promise<void> => {
    const controlPlane = ownedControlPlane;
    const gateway = ownedGateway;
    ownedControlPlane = undefined;
    ownedGateway = undefined;
    const database = ownedDatabase;
    ownedDatabase = undefined;
    await controlPlane?.stop().catch(() => undefined);
    await gateway?.stop().catch(() => undefined);
    const sharedDatabase = database !== undefined && "shared" in database && database.shared === true;
    if (!sharedDatabase) await database?.stop().catch(() => undefined);
  };
  registerCleanup(stopOwnedProcesses);

  if (storedToken !== undefined) {
    const health = await ensureLocalControlPlane({ apiUrl, fetch, ...(options.signal === undefined ? {} : { signal: options.signal }) });
    throwIfAborted(options.signal);
    if (health.kind === "ready") {
      const localSecret = extractLocalSecret(storedToken);
      if (localSecret === undefined) {
        secretStore.clear();
        storedToken = undefined;
      } else {
        const gateway = await ensureLocalModelGatewayWithReporting({
          env: options.env,
          operatorId: localOperatorId,
          apiUrl: modelGatewayUrl,
          token: options.env.MAESTRO_MODEL_GATEWAY_TOKEN?.trim() || deriveModelGatewayToken(localSecret),
          fetch,
          retryDelayMs,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          ...(options.onStep === undefined ? {} : { onStep: options.onStep }),
          ...(options.startModelGateway === undefined ? {} : { startModelGateway: options.startModelGateway }),
        });
        if (gateway.kind !== "ready") {
          throwIfAborted(options.signal);
          return { kind: "setup-required", reason: gateway.reason };
        }
        ownedGateway = gateway.process;
        throwIfAborted(options.signal);
        gatewayReady = true;
        const validation = await validateLocalToken(apiUrl, storedToken, fetch, options.signal);
        if (validation.kind === "valid") {
          const projectId = options.includeProjectId ? validation.projectId : undefined;
          return { kind: "configured", apiUrl, token: storedToken, ...(projectId === undefined ? {} : { projectId }) };
        }
        if (validation.kind === "unavailable") {
          reportSetupStep(options.onStep, "control-plane-up", "failed", validation.reason);
          await stopOwnedProcesses();
          return { kind: "setup-required", reason: validation.reason };
        }
        // Keep the stable local secret when rotating only the Control Plane
        // credential. The gateway token is derived from this secret, so the
        // running gateway and the new Control Plane process remain compatible.
        bootstrapSecret = localSecret;
        secretStore.clear();
        storedToken = undefined;
      }
    }
  }

  const configuredDatabaseUrl = options.env.MAESTRO_LOCAL_DATABASE_URL?.trim();
  const databaseSelection = await ensureLocalDatabase({
    env: options.env,
    databaseUrl: configuredDatabaseUrl,
    dataDir: options.env.MAESTRO_LOCAL_DATA_DIR?.trim() || join(homedir(), ".local", "share", "maestro"),
    runCommand,
    retryDelayMs,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.startEmbeddedDatabase === undefined ? {} : { startEmbeddedDatabase: options.startEmbeddedDatabase }),
    ...(options.onStep === undefined ? {} : { onStep: options.onStep }),
  });
  if (databaseSelection.kind === "unavailable") {
    throwIfAborted(options.signal);
    return { kind: "setup-required", reason: databaseSelection.reason };
  }
  const databaseUrl = databaseSelection.databaseUrl;
  ownedDatabase = databaseSelection.process;
  throwIfAborted(options.signal);

  const initialHealth = await ensureLocalControlPlane({
    apiUrl,
    fetch,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  throwIfAborted(options.signal);
  let bootstrap: Awaited<ReturnType<typeof runBootstrapHelper>> | undefined;

  // The bootstrap helper is the parent-visible migration operation. Run it
  // before starting either service so the callback reflects the real setup
  // order instead of inferring migrations from a later health poll.
  if (storedToken === undefined) {
    const entry = resolveControlPlaneEntry(options.env);
    if (initialHealth.kind !== "ready" && entry === undefined) {
      const reason =
        "Local Control Plane is not running and its executable was not found; set MAESTRO_CONTROL_PLANE_ENTRY or configure MAESTRO_API_URL and MAESTRO_API_TOKEN";
      reportSetupStep(options.onStep, "control-plane-up", "failed", reason);
      await stopOwnedProcesses();
      return { kind: "setup-required", reason };
    }
    bootstrapSecret = bootstrapSecret ?? randomBytes(32).toString("base64url");
    const projectId = randomUUID();
    reportSetupStep(options.onStep, "migrations", "started");
    bootstrap = await runBootstrapHelper({
      env: options.env,
      databaseUrl,
      secret: bootstrapSecret,
      projectId,
      operatorId: localOperatorId,
      runCommand,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (bootstrap.kind === "unavailable") {
      reportSetupStep(options.onStep, "migrations", "failed", bootstrap.reason);
      await stopOwnedProcesses();
      return { kind: "setup-required", reason: bootstrap.reason };
    }
    reportSetupStep(options.onStep, "migrations", "completed");
    bootstrapProjectId = options.includeProjectId ? bootstrap.projectId : undefined;
  }

  if (initialHealth.kind !== "ready") {
    const entry = resolveControlPlaneEntry(options.env);
    if (entry === undefined) {
      const reason =
        "Local Control Plane is not running and its executable was not found; set MAESTRO_CONTROL_PLANE_ENTRY or configure MAESTRO_API_URL and MAESTRO_API_TOKEN";
      reportSetupStep(options.onStep, "control-plane-up", "failed", reason);
      await stopOwnedProcesses();
      return { kind: "setup-required", reason };
    }
    bootstrapSecret = bootstrapSecret ?? extractLocalSecret(storedToken) ?? randomBytes(32).toString("base64url");
    const modelGatewayToken = options.env.MAESTRO_MODEL_GATEWAY_TOKEN?.trim() || deriveModelGatewayToken(bootstrapSecret);
    const modelGatewayOperatorId = options.env.MAESTRO_MODEL_GATEWAY_OPERATOR_ID?.trim() || localOperatorId;
    const dataDir = options.env.MAESTRO_LOCAL_DATA_DIR?.trim() || join(homedir(), ".local", "share", "maestro");
    try {
      await makeLocalDataDirectories(dataDir);
      reportSetupStep(options.onStep, "control-plane-up", "started");
      ownedControlPlane =
        (await startOwnedProcessWithCancellation(
          () =>
            (options.startControlPlane ?? defaultStartControlPlane)({
              entry,
              databaseUrl,
              dataDir,
              apiUrl,
              modelGatewayUrl,
              modelGatewayToken,
              modelGatewayOperatorId,
              ...(options.env.MAESTRO_MODEL_ROUTING_MODE === undefined ? {} : { modelRoutingMode: options.env.MAESTRO_MODEL_ROUTING_MODE }),
              ...(options.env.MAESTRO_NATIVE_MODEL === undefined ? {} : { nativeModelRef: options.env.MAESTRO_NATIVE_MODEL }),
              ...(options.env.MAESTRO_ENSEMBLE_CANDIDATE_CATALOG === undefined
                ? {}
                : { ensembleCandidateCatalogPath: options.env.MAESTRO_ENSEMBLE_CANDIDATE_CATALOG }),
              ...(options.env.MAESTRO_MODEL_ACCOUNT_REFS === undefined ? {} : { modelAccountRefs: options.env.MAESTRO_MODEL_ACCOUNT_REFS }),
              ...(options.env.MAESTRO_MODEL_MAP === undefined ? {} : { modelMapPath: options.env.MAESTRO_MODEL_MAP }),
            }),
          options.signal,
        )) ?? undefined;
    } catch (error) {
      if (options.signal?.aborted) throw error;
      const reason = "Local Control Plane could not be started; check its executable and local data directory permissions";
      reportSetupStep(options.onStep, "control-plane-up", "failed", reason);
      await stopOwnedProcesses();
      return { kind: "setup-required", reason };
    }
    // Fresh PostgreSQL migrations and a cold Node process can take several
    // seconds. Retry failed connections, not just hanging requests, while
    // keeping the whole startup window bounded.
    const started = await waitForLocalControlPlane({
      apiUrl,
      fetch,
      retryDelayMs,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    throwIfAborted(options.signal);
    if (started.kind !== "ready") {
      const reason = `Local Control Plane startup failed: ${started.reason}`;
      reportSetupStep(options.onStep, "control-plane-up", "failed", reason);
      await stopOwnedProcesses();
      return { kind: "setup-required", reason };
    }
    reportSetupStep(options.onStep, "control-plane-up", "completed");
  }

  if (!gatewayReady) {
    bootstrapSecret = bootstrapSecret ?? extractLocalSecret(storedToken) ?? randomBytes(32).toString("base64url");
    const modelGatewayToken = options.env.MAESTRO_MODEL_GATEWAY_TOKEN?.trim() || deriveModelGatewayToken(bootstrapSecret);
    const gateway = await ensureLocalModelGatewayWithReporting({
      env: options.env,
      operatorId: localOperatorId,
      apiUrl: modelGatewayUrl,
      token: modelGatewayToken,
      fetch,
      retryDelayMs,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.onStep === undefined ? {} : { onStep: options.onStep }),
      ...(options.startModelGateway === undefined ? {} : { startModelGateway: options.startModelGateway }),
    });
    if (gateway.kind !== "ready") {
      throwIfAborted(options.signal);
      await stopOwnedProcesses();
      return { kind: "setup-required", reason: gateway.reason };
    }
    ownedGateway = gateway.process;
    throwIfAborted(options.signal);
    gatewayReady = true;
  }

  // A keychain token may have been valid before a restart even though the
  // Control Plane was temporarily down. Reuse it after the local process is
  // back instead of issuing another credential on every launch.
  if (storedToken !== undefined) {
    const validation = await validateLocalToken(apiUrl, storedToken, fetch, options.signal);
    if (validation.kind === "valid") {
      const projectId = options.includeProjectId ? validation.projectId : undefined;
      return { kind: "configured", apiUrl, token: storedToken, ...(projectId === undefined ? {} : { projectId }) };
    }
    if (validation.kind === "unavailable") {
      reportSetupStep(options.onStep, "control-plane-up", "failed", validation.reason);
      await stopOwnedProcesses();
      return { kind: "setup-required", reason: validation.reason };
    }
    bootstrapSecret = extractLocalSecret(storedToken);
    secretStore.clear();
    storedToken = undefined;
  }

  if (bootstrap === undefined) {
    const secret = bootstrapSecret ?? randomBytes(32).toString("base64url");
    const projectId = randomUUID();
    reportSetupStep(options.onStep, "migrations", "started");
    bootstrap = await runBootstrapHelper({
      env: options.env,
      databaseUrl,
      secret,
      projectId,
      operatorId: localOperatorId,
      runCommand,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (bootstrap.kind === "unavailable") {
      reportSetupStep(options.onStep, "migrations", "failed", bootstrap.reason);
      await stopOwnedProcesses();
      return { kind: "setup-required", reason: bootstrap.reason };
    }
    reportSetupStep(options.onStep, "migrations", "completed");
    bootstrapSecret = secret;
    bootstrapProjectId = options.includeProjectId ? bootstrap.projectId : undefined;
  }
  const secret = bootstrapSecret!;
  if (bootstrap === undefined || bootstrap.kind !== "ready") {
    const reason = "Local operator bootstrap returned no credential";
    reportSetupStep(options.onStep, "migrations", "failed", reason);
    await stopOwnedProcesses();
    return { kind: "setup-required", reason };
  }
  const token = `${bootstrap.credentialId}.${secret}`;
  try {
    secretStore.write(token);
  } catch {
    const reason =
      "Local operator was created, but the OS keychain is unavailable; set MAESTRO_API_TOKEN explicitly or enable a system keychain";
    reportSetupStep(options.onStep, "control-plane-up", "failed", reason);
    await stopOwnedProcesses();
    return { kind: "setup-required", reason };
  }

  const validation = await validateLocalToken(apiUrl, token, fetch, options.signal);
  if (validation.kind !== "valid") {
    const reason =
      validation.kind === "unavailable" ? validation.reason : "Local operator bootstrap completed but Control Plane authentication failed";
    reportSetupStep(options.onStep, "control-plane-up", "failed", reason);
    await stopOwnedProcesses();
    secretStore.clear();
    return { kind: "setup-required", reason };
  }
  return { kind: "configured", apiUrl, token, ...(bootstrapProjectId === undefined ? {} : { projectId: bootstrapProjectId }) };
}
