import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { AuthorizedEffectExecutor, type ActionRequest } from "@maestro/authority";
import { createLocalGitPort } from "@maestro/git-adapter";
import type { ExecutionAdmission, ExecutionKernelPort, GitPort } from "@maestro/domain";
import { createIpPythonSessionManager, createIpPythonTool, parseModelRef, ToolRegistry, type IpPythonKernel } from "@maestro/agent-runtime";
import { appendIpPythonSessionJournal, assertProjectMembership, authenticateLocalOperator, bootstrapPermanentOrganization, createPostgresAccountLoginStore, listProjectMemberships, getGoalControl, listGoalEvents, PostgresAuthorityRepository, provisionProjectAccess, reconcileIpPythonOrphans, reconcileOnStartup, recordDiscordSignal, recordIpPythonSessionStarted, runMigrations, type IpPythonSessionJournalEntry } from "@maestro/persistence";
import { parseConfig, type MaestroConfig } from "./config.js";
import { createCriticalActionService, CriticalActionGoalNotFoundError, CriticalActionProjectMismatchError } from "./critical-action-service.js";
import { createDurableGoalService } from "./goal-service.js";
import { createReadStateService } from "./read-state-service.js";
import { createDurableTaskContractService } from "./task-contract-service.js";
import { createHeadParticipationService } from "./head-participation-service.js";
import { createCouncilService } from "./council-service.js";
import { createDepartmentPlanService } from "./department-plan-service.js";
import { createMissionBundleService } from "./mission-bundle-service.js";
import { createWorkerService } from "./worker-service.js";
import { createGitIntegrationService } from "./git-integration-service.js";
import { createCertificationService } from "./certification-service.js";
import { createMetronomeService } from "./metronome-service.js";
import { createEncoreService } from "./encore-service.js";
import { buildServer, type OperatorAuthenticator } from "./server.js";
import { createMetronomeLoop } from "./metronome-loop.js";
import { createModelGatewayClient } from "./model-gateway-client.js";
import { createNativeExecutionKernel, createUnavailableNativeExecutionKernel } from "./native-execution-kernel.js";
import { createPostgresConversationService } from "./conversation-service.js";
import { createIpPythonProductionKernel } from "./ipython-composition.js";

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
      new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function inspectIpPythonProcessOutcome(entry: IpPythonSessionJournalEntry): "reaped" | "unknown" {
  if (entry.processPid === null) return "unknown";
  try {
    process.kill(entry.processPid, 0);
    // Existence is not proof of ownership or a terminal provider outcome.
    return "unknown";
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") return "reaped";
    return "unknown";
  }
}

export type NativeAdmissionInput =
  | { purpose: "head"; goalId: string; projectId: string; departmentId: string; actorId: string; sessionRef: string; commandId: string; fencingToken: string }
  | { purpose: "encore"; goalId: string; projectId: string; commandId: string; reviewerIndex: number; fencingToken: string };

function createHostNativeAdmission(config: MaestroConfig, input: NativeAdmissionInput): ExecutionAdmission {
  if (config.nativeModelRef === undefined) throw new Error("Native execution requires MAESTRO_NATIVE_MODEL");
  const model = parseModelRef(config.nativeModelRef);
  const accountRef = config.modelAccountRefs[model.provider];
  if (accountRef === undefined) throw new Error(`Native execution has no account binding for provider: ${model.provider}`);
  const suffix = input.purpose === "head" ? input.departmentId : `reviewer-${input.reviewerIndex}`;
  const grantId = `native:${input.purpose}:${input.goalId}:${suffix}`;
  return {
    context: { operatorId: input.purpose === "head" ? input.actorId : config.actorId, projectId: input.projectId, goalId: input.goalId, missionBundleId: `native-${input.purpose}`, policyVersion: "native-host-v1", accountRef, fencingToken: input.fencingToken },
    grant: { grantId, allowedTools: [], allowedSkills: [], modelPolicy: [config.nativeModelRef], pathScope: [config.worktreeRoot], outboundDataClasses: ["workspace"], remaining: { modelTurns: 8, toolCalls: 0, childCalls: 0, outputTokens: 8_192, wallTimeMs: 120_000, retryCount: 0 } },
    modelPolicy: [config.nativeModelRef],
    // A council command fans out into independent roots; their gateway
    // admissions must not replay the same idempotency identity.
    idempotencyKey: input.purpose === "encore" ? `${input.commandId}:reviewer:${input.reviewerIndex}` : input.commandId,
  };
}

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
  const modelGateway = config.modelGatewayToken === undefined ? undefined : createModelGatewayClient({ baseUrl: config.modelGatewayUrl!, token: config.modelGatewayToken });
  const accountLoginStore = modelGateway === undefined ? undefined : createPostgresAccountLoginStore(pool);
  const accountLoginOwnerId = `${config.leaseOwnerId}:${randomUUID()}`;
  const authorityRepository = new PostgresAuthorityRepository(pool);
  const authorityExecutor = new AuthorizedEffectExecutor(authorityRepository);
  const ipythonSessions = createIpPythonSessionManager({
    createKernel: async (sessionId, binding) => {
      if (overrides.ipythonKernel !== undefined) return overrides.ipythonKernel;
      if (binding === undefined) throw new Error("IPython production kernel requires an authority binding");
      const processRef = `ipython:${randomUUID()}`;
      return createIpPythonProductionKernel({
        authority: authorityExecutor,
        workspaceRoot: config.worktreeRoot,
        pythonExecutable: config.ipythonPythonExecutable ?? "/usr/bin/python3",
        processRef,
        onStarted: async (event) => {
          await recordIpPythonSessionStarted(pool, {
            sessionId,
            processRef: event.processRef,
            projectId: binding.projectId,
            goalId: binding.goalId,
            processPid: event.processPid,
            parentPid: event.parentPid,
          });
        },
        onLifecycle: async (event) => {
          await appendIpPythonSessionJournal(pool, {
            sessionId,
            processRef: event.processRef,
            projectId: binding.projectId,
            goalId: binding.goalId,
            event: "orphaned",
            reason: event.reason,
            processPid: event.processPid,
            parentPid: event.parentPid,
          });
        },
      }, sessionId, binding);
    },
  });
  const tools = new ToolRegistry();
  tools.register(createIpPythonTool({ sessions: ipythonSessions }));
  const executionKernel = overrides.executionKernel ?? (modelGateway === undefined
    ? createUnavailableNativeExecutionKernel()
    : createNativeExecutionKernel({ gateway: modelGateway, gatewayOperatorId: config.modelGatewayOperatorId, accountRefs: config.modelAccountRefs, dataPolicyHash: createHash("sha256").update("maestro-native-data-policy:v1").digest("hex"), tools }));
  const nativeAdmission = overrides.nativeAdmission ?? (modelGateway === undefined ? undefined : (input: NativeAdmissionInput) => createHostNativeAdmission(config, input));
  const conversationService = modelGateway === undefined ? undefined : createPostgresConversationService({ pool, gateway: modelGateway, gatewayOperatorId: config.modelGatewayOperatorId, accountRefs: config.modelAccountRefs });
  const goalService = createDurableGoalService({
    pool,
    actorId: config.actorId,
    leaseOwnerId: config.leaseOwnerId,
  });
  const authenticator: OperatorAuthenticator = {
    authenticateBearerSecret: (secret) => authenticateLocalOperator(pool, secret),
  };
  const criticalActionService = createCriticalActionService({
    pool,
    ...(config.ceoOperatorId === undefined ? {} : { ceoOperatorId: config.ceoOperatorId }),
    repository: authorityRepository,
    getControlEpoch: async (projectId, goalId) => (await getGoalControl(pool, projectId, goalId)).controlEpoch,
    assertGoalProjectBinding: async (projectId, goalId) => {
      const goal = await pool.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1", [goalId]);
      if (goal.rowCount !== 1) throw new CriticalActionGoalNotFoundError();
      if (goal.rows[0]!.project_id !== projectId) throw new CriticalActionProjectMismatchError();
    },
    // Do not claim an authorized effect when no concrete adapter is composed.
    // A missing production adapter fails closed instead of returning allow for
    // a no-op callback. Tests may inject a real observable effect.
    effect: overrides.criticalActionEffect ?? (async () => { throw new Error("No critical-action effect adapter is configured"); }),
  });
  const headParticipationService = createHeadParticipationService({
    pool,
    kernel: executionKernel,
    withGoalLease: goalService.withGoalLease!,
    ...(nativeAdmission === undefined ? {} : { createAdmission: (input) => nativeAdmission({ purpose: "head", ...input }) }),
  });
  const councilService = createCouncilService({ pool, withGoalLease: goalService.withGoalLease! });
  const departmentPlanService = createDepartmentPlanService({ pool, withGoalLease: goalService.withGoalLease! });
  const missionBundleService = createMissionBundleService({ pool, withGoalLease: goalService.withGoalLease! });
  const workerService = createWorkerService({ pool, kernel: executionKernel, withGoalLease: goalService.withGoalLease!, ...(config.maxConcurrentWorkersPerProject === undefined ? {} : { maxConcurrentWorkersPerProject: config.maxConcurrentWorkersPerProject }) });
  const gitIntegrationService = createGitIntegrationService({
    pool, withGoalLease: goalService.withGoalLease!,
    createGitPort: (context) => overrides.gitPort ?? createLocalGitPort({ authority: authorityExecutor, context, workspaceRoot: config.worktreeRoot }),
    getControlEpoch: async (projectId, goalId) => (await getGoalControl(pool, projectId, goalId)).controlEpoch,
  });
  const certificationService = createCertificationService({ pool, withGoalLease: goalService.withGoalLease! });
  const metronomeService = createMetronomeService({ pool, withGoalLease: goalService.withGoalLease! });
  const encoreService = createEncoreService({
    pool, kernel: executionKernel, withGoalLease: goalService.withGoalLease!,
    ...(nativeAdmission === undefined ? {} : { createAdmission: (input) => nativeAdmission({ purpose: "encore", ...input }) }),
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
    metronomeService,
    encoreService,
    authenticator,
    eventService: { listEvents: (projectId, after) => listGoalEvents(pool, { projectId, after }) },
    ...(conversationService === undefined ? {} : { conversationService }),
    ...(accountLoginStore === undefined ? {} : { accountLoginStore, accountLoginOwnerId }),
    // The Model Gateway process authenticates one fixed gateway-level
    // operator identity (config.modelGatewayOperatorId), matching exactly
    // how native admission already calls gateway.admit() with
    // gatewayOperatorId rather than the calling end-user's own operator ID
    // (apps/control-plane/src/native-execution-kernel.ts). Provider
    // credentials and managed logins are shared per Control-Plane process,
    // not per individual Maestro operator; the real end-user's identity and
    // authorization remain enforced entirely by Maestro's own persistence
    // layer (accountLoginStore, project membership, roles), which still
    // receives and scopes by the real operatorId untouched. Forwarding the
    // real end-user operatorId to the gateway's own operatorId-equality
    // check instead of this fixed constant made every credential bind and
    // every account-login call fail closed with "credential operator
    // context mismatch" for any authenticated operator whose ID is not
    // literally equal to the configured gateway operator ID -- i.e. always,
    // for every real multi-operator deployment.
    ...(modelGateway === undefined || modelGateway.bindCredential === undefined || modelGateway.revokeCredential === undefined ? {} : {
      providerCredentials: {
        bind: (input: { operatorId: string; requestId: string; providerId: "openai" | "anthropic"; authMode: "api-key"; secret: string }) => modelGateway.bindCredential!({ ...input, operatorId: config.modelGatewayOperatorId }),
        revoke: (input: { operatorId: string; requestId: string; providerId: "openai" | "anthropic" }) => modelGateway.revokeCredential!({ ...input, operatorId: config.modelGatewayOperatorId }),
        ...(modelGateway.startAccountLogin === undefined || modelGateway.accountLoginStatus === undefined || modelGateway.cancelAccountLogin === undefined ? {} : {
          startAccountLogin: (input: { operatorId: string; requestId: string; providerId: "openai-codex" }) => modelGateway.startAccountLogin!({ ...input, operatorId: config.modelGatewayOperatorId }),
          accountLoginStatus: (input: { operatorId: string; requestId: string; providerId: "openai-codex"; loginId: string }) => modelGateway.accountLoginStatus!({ ...input, operatorId: config.modelGatewayOperatorId }),
          cancelAccountLogin: (input: { operatorId: string; requestId: string; providerId: "openai-codex"; loginId: string }) => modelGateway.cancelAccountLogin!({ ...input, operatorId: config.modelGatewayOperatorId }),
          ...(modelGateway.logoutAccount === undefined ? {} : { logoutAccount: (input: { operatorId: string; requestId: string; providerId: "openai-codex" }) => modelGateway.logoutAccount!({ ...input, operatorId: config.modelGatewayOperatorId }) }),
        }),
      },
    }),
    criticalActionService,
    readStateService: createReadStateService(pool),
    taskContractService: createDurableTaskContractService(pool),
    ...(config.discordSignalCredential === undefined ? {} : {
      discordSignalService: { record: (envelope) => recordDiscordSignal(pool, envelope, config.discordSignalCredential!) },
    }),
    projectMembership: { assertProjectMembership: (operatorId, projectId) => assertProjectMembership(pool, operatorId, projectId) },
    projectDiscovery: { listProjects: (operatorId) => listProjectMemberships(pool, operatorId) },
    ...(config.operatorProvisioningAdminId === undefined ? {} : {
      projectAccess: {
        provisionProjectAccess: (requesterOperatorId, input) => provisionProjectAccess(
          pool,
          requesterOperatorId,
          input,
          { adminOperatorId: config.operatorProvisioningAdminId! },
        ),
      },
    }),
    readinessCheck: async () => { await pool.query("SELECT 1"); },
    ...(https ? { https } : {}),
  });
  const metronomeLoop = config.metronomeIntervalMs === undefined
    ? undefined
    : createMetronomeLoop({ pool, withGoalLease: goalService.withGoalLease!, intervalMs: config.metronomeIntervalMs });
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
    },
    async close() {
      if (closed) return;
      closed = true;
      metronomeLoop?.stop();
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
  const close = async () => { await controlPlane.close(); };
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
