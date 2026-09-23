import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { AuthorizedEffectExecutor, type ActionRequest } from "@maestro/authority";
import { createLocalGitPort } from "@maestro/git-adapter";
import type { ExecutionAdmission, ExecutionKernelPort, GitPort } from "@maestro/domain";
import {
  createIpPythonTool,
  ToolRegistry,
  type IpPythonKernel,
  type IpPythonSessionBinding,
  type IpPythonSessionManager,
} from "@maestro/agent-runtime";
import {
  assertProjectMembership,
  bootstrapPermanentOrganization,
  createPostgresAccountLoginStore,
  listProjectMemberships,
  listPermanentOrganization,
  listGoalEvents,
  PostgresAuthorityRepository,
  provisionProjectAccess,
  reconcileIpPythonOrphans,
  reconcileOnStartup,
  recordDiscordSignal,
  listPendingAuthorityApprovals,
  runMigrations,
  getChannel,
  postChannelMessage,
} from "@maestro/persistence";
import { parseConfig, type MaestroConfig } from "./config.js";
import { buildServer } from "./server.js";
import { createReadStateService } from "./read-state-service.js";
import { createProjectionService } from "./projection-service.js";
import { createMetronomeLoop } from "./metronome-loop.js";
import { createStartGoalOutboxLoop } from "./start-goal-outbox-loop.js";
import { createModelGatewayClient } from "./model-gateway-client.js";
import { createNativeExecutionKernel, createUnavailableNativeExecutionKernel } from "./native-execution-kernel.js";
import type { NativeAdmissionInput } from "./native-admission.js";
import { createControlPlaneIpPythonSessions } from "./composition/sessions.js";
import { composeFoundationServices } from "./composition/foundation-services.js";
import { composeExecutionServices } from "./composition/execution-services.js";
import { composeProviderCredentials, composeSettingsService } from "./composition/provider-access.js";
import { composeRouterCatalogService } from "./composition/router-catalog.js";
import { createPostgresOvertureService } from "./overture-service.js";
import { inspectIpPythonProcessOutcome } from "./composition/ipython.js";

export type { NativeAdmissionInput } from "./native-admission.js";
export { ipPythonStageJournalEvent, resolveWorkerIpPythonComposition, type WorkerIpPythonComposition } from "./composition/ipython.js";

export interface ControlPlane {
  app: ReturnType<typeof buildServer>;
  pool: Pool;
  config: MaestroConfig;
  listen(): Promise<void>;
  close(): Promise<void>;
  /** The production authority gateway for runtime/browser effect adapters. */
  createEnvironmentAuthority(): AuthorizedEffectExecutor;
  /** Builds a Git port whose every operation is audited and control-checked. */
  createGitPort(context: Omit<ActionRequest, "action" | "target">): GitPort;
}

/** Resolve shutdown even when a provider adapter hangs during abort/disposal. */
async function drainWithTimeout(operation: Promise<void> | undefined, timeoutMs: number): Promise<void> {
  if (operation === undefined) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation.catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Map a runtime stage boundary to the durable approval-journal event category. */
export interface ControlPlaneOverrides {
  /** Test-only injection point for the critical-action effect callback. Production fails closed until a real adapter is configured. */
  criticalActionEffect?: (request: ActionRequest) => Promise<void>;
  /** Test-only kernel injection; production uses the native Model Gateway kernel. */
  executionKernel?: ExecutionKernelPort;
  /** Test seam for asserting host-owned admissions on root sessions. */
  nativeAdmission?: (input: NativeAdmissionInput) => ExecutionAdmission;
  /** Test-only Git injection; production always uses the authority-backed local adapter. */
  gitPort?: GitPort;
  /** Test-only IPython kernel injection; production remains fail-closed until the 1B bridge is composed. */
  ipythonKernel?: IpPythonKernel;
  /** Test-only lazy factory for lifecycle harnesses that must create a process after startup reconciliation. */
  createIpPythonKernel?: (sessionId: string, binding?: IpPythonSessionBinding) => IpPythonKernel | Promise<IpPythonKernel>;
  /** Test-only observer for driving the already-composed production IPython session manager. */
  onIpPythonSessionManager?: (manager: IpPythonSessionManager) => void;
}

/** Compose the local Goal API and expose only authority-backed effect gateways. Credential setup remains controlled; project access uses the explicit admin gateway. */
export function createControlPlane(config: MaestroConfig, overrides: ControlPlaneOverrides = {}): ControlPlane {
  // Enforce the TLS-fail-closed invariant at this composition boundary too,
  // not only in parseConfig: a caller may construct MaestroConfig directly
  // (bypassing parseConfig entirely), and bearer secrets must never travel
  // in cleartext on a non-loopback bind either way.
  const isRemoteBind = config.host !== "127.0.0.1" && config.host !== "localhost";
  if (isRemoteBind && !config.tls) {
    throw new Error("Remote binding requires TLS certificate and key configuration");
  }
  const https = config.tls ? { cert: readFileSync(config.tls.certFile), key: readFileSync(config.tls.keyFile) } : undefined;
  const pool = new Pool({ connectionString: config.databaseUrl });
  const modelGateway =
    config.modelGatewayToken === undefined
      ? undefined
      : createModelGatewayClient({ baseUrl: config.modelGatewayUrl!, token: config.modelGatewayToken });
  const accountLoginStore = modelGateway === undefined ? undefined : createPostgresAccountLoginStore(pool);
  const accountLoginOwnerId = `${config.leaseOwnerId}:${randomUUID()}`;
  const authorityRepository = new PostgresAuthorityRepository(pool);
  const authorityExecutor = new AuthorizedEffectExecutor(authorityRepository);
  const ipythonSessions = createControlPlaneIpPythonSessions({ pool, config, overrides, authorityExecutor });
  overrides.onIpPythonSessionManager?.(ipythonSessions);
  const tools = new ToolRegistry();
  tools.register(createIpPythonTool({ sessions: ipythonSessions }));
  const executionKernel =
    overrides.executionKernel ??
    (modelGateway === undefined
      ? createUnavailableNativeExecutionKernel()
      : createNativeExecutionKernel({
          gateway: modelGateway,
          gatewayOperatorId: config.modelGatewayOperatorId,
          accountRefs: config.modelAccountRefs,
          dataPolicyHash: createHash("sha256").update("maestro-native-data-policy:v1").digest("hex"),
          tools,
        }));
  const {
    taskContractService,
    conversationService,
    goalService,
    authenticator,
    criticalActionService,
    capabilityApprovalService,
    evidenceCaptureService,
    personaGoalEvidenceService,
    personaInspectionService,
    withGoalLease,
  } = composeFoundationServices({ pool, config, overrides, authorityRepository, modelGateway });
  const {
    headParticipationService,
    councilService,
    departmentPlanService,
    missionBundleService,
    gitIntegrationService,
    workerService,
    certificationService,
    concertmasterReportService,
    metronomeService,
    encoreService,
  } = composeExecutionServices({ pool, config, overrides, withGoalLease, executionKernel, authorityExecutor, modelGateway });
  const providerCredentials = composeProviderCredentials({ pool, config, modelGateway });
  const settingsService = composeSettingsService({ pool, config, modelGateway });
  const routerCatalogService = composeRouterCatalogService({
    pool,
    config,
    ...(modelGateway === undefined ? {} : { modelGateway }),
    settingsService,
  });
  const app = buildServer({
    goalService,
    headParticipationService,
    councilService,
    departmentPlanService,
    missionBundleService,
    workerService,
    gitIntegrationService,
    certificationService,
    concertmasterReportService,
    metronomeService,
    encoreService,
    authenticator,
    eventService: { listEvents: (projectId, after) => listGoalEvents(pool, { projectId, after }) },
    ...(conversationService === undefined ? {} : { conversationService }),
    overture: createPostgresOvertureService({
      pool,
      ...(modelGateway === undefined ? {} : { gateway: modelGateway }),
      gatewayOperatorId: config.modelGatewayOperatorId,
      accountRefs: config.modelAccountRefs,
      dataPolicyHash: createHash("sha256").update("maestro-overture-data-policy:v1").digest("hex"),
      tools,
    }),
    settingsService,
    routerCatalogService,
    ...(accountLoginStore === undefined ? {} : { accountLoginStore, accountLoginOwnerId }),
    ...(providerCredentials === undefined ? {} : { providerCredentials }),
    criticalActionService,
    inboxService: {
      listPendingApprovals: async (projectId) => ({
        projectId,
        items: (await listPendingAuthorityApprovals(pool, projectId)).map((item) => ({
          ...item,
          decidedAt: item.decidedAt.toISOString(),
        })),
      }),
    },
    capabilityApprovalService,
    evidenceCaptureService,
    personaGoalEvidenceService,
    personaInspectionService,
    readStateService: createReadStateService(pool),
    projectionService: createProjectionService(pool),
    taskContractService,
    ...(config.discordSignalCredential === undefined
      ? {}
      : {
          discordSignalService: { record: (envelope) => recordDiscordSignal(pool, envelope, config.discordSignalCredential!) },
        }),
    projectMembership: { assertProjectMembership: (operatorId, projectId) => assertProjectMembership(pool, operatorId, projectId) },
    projectDiscovery: { listProjects: (operatorId) => listProjectMemberships(pool, operatorId) },
    organizationService: { listOrganization: () => listPermanentOrganization(pool) },
    channelService: {
      get: (input) => getChannel(pool, input),
      post: (input) => postChannelMessage(pool, input),
    },
    ...(config.operatorProvisioningAdminId === undefined
      ? {}
      : {
          projectAccess: {
            provisionProjectAccess: (requesterOperatorId, input) =>
              provisionProjectAccess(pool, requesterOperatorId, input, { adminOperatorId: config.operatorProvisioningAdminId! }),
          },
        }),
    readinessCheck: async () => {
      await pool.query("SELECT 1");
    },
    ...(https ? { https } : {}),
  });
  const drainCapacityQueues = workerService.drainCapacityQueues?.bind(workerService);
  const metronomeLoop =
    config.metronomeIntervalMs === undefined
      ? undefined
      : createMetronomeLoop({
          pool,
          kernel: executionKernel,
          withGoalLease,
          intervalMs: config.metronomeIntervalMs,
          ...(drainCapacityQueues === undefined ? {} : { drainCapacityQueues }),
        });
  const capacityQueueLoop =
    metronomeLoop === undefined && drainCapacityQueues !== undefined
      ? createMetronomeLoop({ pool, withGoalLease, intervalMs: 1_000, scanGoals: false, drainCapacityQueues })
      : undefined;
  const startGoalOutboxLoop =
    config.startGoalOutboxIntervalMs === undefined
      ? undefined
      : createStartGoalOutboxLoop({
          pool,
          ownerId: `${config.leaseOwnerId}:start-goal`,
          intervalMs: config.startGoalOutboxIntervalMs,
        });
  let closed = false;

  return {
    app,
    pool,
    config,
    createEnvironmentAuthority() {
      return authorityExecutor;
    },
    createGitPort(context) {
      return createLocalGitPort({ authority: authorityExecutor, context, workspaceRoot: config.worktreeRoot });
    },
    async listen() {
      // The schema must be current before any reconciliation or traffic:
      // apply every not-yet-recorded migration (additive-only, advisory-
      // lock-serialized against concurrent instances, fails closed on a
      // changed already-applied migration file) before reconcileOnStartup
      // ever queries goal/lease/control tables that a pending migration
      // might still be introducing.
      await runMigrations(pool);
      // A fresh Control Plane cannot honestly resume an old Python process.
      // Reconcile started/orphaned generations before traffic; absence proves
      // only reaping, while every other observation remains unknown.
      await reconcileIpPythonOrphans(pool, { determineOutcome: inspectIpPythonProcessOutcome });
      if (accountLoginStore !== undefined) await accountLoginStore.recoverStarting(accountLoginOwnerId);
      // Seed the immutable canonical organization before provisioning can
      // validate requested roles. This is idempotent and creates no sessions.
      await bootstrapPermanentOrganization(pool);
      // Fail closed: a real process must prove durable Goal/lease state is
      // consistent (or durably marked "recovering") before it ever serves
      // traffic. If the startup reconciliation leader lease cannot be
      // acquired or reconciliation itself fails, this throws and the caller
      // (main()) closes the pool without binding a listener.
      // A freshly constructed kernel here always starts with empty
      // sessions/roots/children state (see execution-kernel.ts), so forcing
      // every orphaned nonterminal worker through it during reconciliation
      // can only ever honestly downgrade a genuinely dead session to
      // "unknown" -- never fabricate or accidentally resume one (Phase 1
      // re-patch item 8 part 2/2: durable worker/session restart recovery).
      await reconcileOnStartup(pool, {
        ownerId: config.leaseOwnerId,
        leaderLeaseDurationMs: config.reconcilerLeaseDurationMs,
        kernel: executionKernel,
      });
      // Rebuild native conversation runtime handles before accepting traffic.
      // Failed rebuilds are durably marked unknown by the conversation service.
      await conversationService?.recover?.();
      await app.listen({ host: config.host, port: config.port });
      metronomeLoop?.start();
      capacityQueueLoop?.start();
      startGoalOutboxLoop?.start();
    },
    async close() {
      if (closed) return;
      closed = true;
      metronomeLoop?.stop();
      capacityQueueLoop?.stop();
      startGoalOutboxLoop?.stop();
      const timeoutMs = config.shutdownDrainTimeoutMs ?? 5_000;
      try {
        // Stop provider work before releasing the HTTP and database resources.
        // This prevents graceful shutdown from orphaning active Head/worker
        // sessions, while the bound keeps SIGTERM from hanging forever on a
        // provider that is already unavailable. SIGKILL remains covered by
        // the durable lease/fence reconciliation path.
        await drainWithTimeout(Promise.resolve(conversationService?.close?.()), timeoutMs);
        await drainWithTimeout(Promise.resolve(ipythonSessions.close()), timeoutMs);
        await drainWithTimeout(Promise.resolve(executionKernel.close?.()), timeoutMs);
      } finally {
        try {
          await drainWithTimeout(app.close(), timeoutMs);
        } finally {
          await drainWithTimeout(pool.end(), timeoutMs);
        }
      }
    },
  };
}

export async function main(env = process.env): Promise<void> {
  const controlPlane = createControlPlane(parseConfig(env));
  const close = async () => {
    await controlPlane.close();
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  try {
    await controlPlane.listen();
  } catch (error) {
    await controlPlane.close();
    throw error;
  }
}

if (import.meta.url === new URL(process.argv[1]!, "file:").href) {
  void main().catch(() => {
    console.error("Control plane failed to start");
    process.exitCode = 1;
  });
}
