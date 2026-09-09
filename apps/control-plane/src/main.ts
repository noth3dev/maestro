import { createHash, randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { Pool } from "pg";
import { AuthorizedEffectExecutor, classifyAction, type ActionRequest } from "@maestro/authority";
import { createLocalGitPort } from "@maestro/git-adapter";
import { classifyHostEffects, type EnvironmentRecord, type ExecutionAdmission, type ExecutionKernelPort, type GitPort } from "@maestro/domain";
import { createIpPythonSessionManager, createIpPythonTool, createUnavailableIpPythonKernel, reapIpPythonProcessGroup, ToolRegistry, type IpPythonBlockApproval, type IpPythonHostRequest, type IpPythonKernel, type IpPythonSessionBinding, type IpPythonSessionManager, type IpPythonStageBoundary } from "@maestro/agent-runtime";
import { appendCapabilityJournal, appendIpPythonSessionJournal, assertProjectMembership, consumeCapabilityApprovals, authenticateLocalOperator, bootstrapAuthorityRecord, bootstrapPermanentOrganization, createPostgresAccountLoginStore, listProjectMemberships, getGoalControl, listGoalEvents, PostgresAuthorityRepository, provisionProjectAccess, readEnvironment, reconcileIpPythonOrphans, reconcileOnStartup, recordDiscordSignal, recordIpPythonSessionStarted, runMigrations, type IpPythonSessionJournalEntry } from "@maestro/persistence";
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
import { createPinnedNativeAdmission, type NativeAdmissionInput } from "./native-admission.js";

export type { NativeAdmissionInput } from "./native-admission.js";

const IPYTHON_LOCAL_ACTIONS = new Set([
  "project.file.read", "project.file.edit", "project.test.run", "project.shell.run", "project.environment.change",
  "git.local.branch.create", "git.local.branch.advance", "git.local.commit", "git.local.revision.read",
  "git.local.worktree.create", "git.local.worktree.remove",
]);

function workerAuthorityAllowsAction(composition: WorkerIpPythonComposition, action: string): boolean {
  if (composition.allowedTools?.includes("ipython") !== true) return false;
  const boundaries = new Set((composition.authorityBoundary ?? []).map((boundary) => boundary.trim().toLowerCase()));
  if (boundaries.has("read-only")) return action === "project.file.read" || action === "git.local.revision.read";
  return boundaries.has("local") || boundaries.has("write-scoped") || boundaries.has("read-write") || boundaries.has("repository");
}

/**
 * Mission Bundle local authority is projected into exact, one-effect grants.
 * The adapters have already canonicalized and path-checked the target before
 * this gateway is called; the grant is still exact and the normal durable
 * authority executor remains the only code that may invoke the effect.
 */
async function isWorkerFencingCurrent(
  pool: Pool,
  composition: Pick<WorkerIpPythonComposition, "workerId" | "ownerId" | "fencingToken" | "repositoryPath">,
  projectId: string,
  goalId: string,
  controlEpoch: string,
): Promise<boolean> {
  if (composition.workerId === undefined || composition.ownerId === undefined || composition.fencingToken === undefined) return false;
  try {
    const [lease, control, worker] = await Promise.all([
      pool.query("SELECT 1 FROM goal_leases WHERE goal_id = $1 AND owner_id = $2 AND fencing_token = $3::bigint AND expires_at > clock_timestamp()", [goalId, composition.ownerId, composition.fencingToken]),
      getGoalControl(pool, projectId, goalId),
      pool.query("SELECT 1 FROM workers WHERE worker_id = $1 AND owner_id = $2 AND owner_fencing_token = $3::bigint AND owner_lease_expires_at > clock_timestamp() AND status IN ('spawned', 'running')", [composition.workerId, composition.ownerId, composition.fencingToken]),
    ]);
    return lease.rowCount === 1 && worker.rowCount === 1 && control.controlEpoch === controlEpoch && control.emergencyStoppedAt === undefined && control.stoppingAt === undefined && control.stoppedAt === undefined;
  } catch { return false; }
}

function createWorkerIpPythonAuthority(
  base: AuthorizedEffectExecutor,
  pool: Pool,
  binding: { readonly operatorId: string; readonly projectId: string; readonly goalId: string; readonly commandId: string; readonly authorityPolicyVersion: number; readonly budgetEffectCents: number; readonly controlEpoch: string },
  composition: WorkerIpPythonComposition,
): { execute(request: ActionRequest, effect: () => Promise<unknown>): Promise<import("@maestro/authority").AuthorityDecision> } {
  return {
    async execute(request, effect) {
      const environmentActor = composition.workerId !== undefined && request.actorId === composition.workerId
        && ["project.test.run", "project.shell.run", "project.environment.change"].includes(request.action);
      const boundaryAllowsRequest = request.projectId === binding.projectId && request.goalId === binding.goalId && (request.actorId === binding.operatorId || environmentActor)
        && request.policyVersion === binding.authorityPolicyVersion && request.budgetEffectCents === binding.budgetEffectCents
        && request.controlEpoch === binding.controlEpoch && IPYTHON_LOCAL_ACTIONS.has(request.action) && workerAuthorityAllowsAction(composition, request.action) && classifyAction(request.action) === "ordinary";
      if (!boundaryAllowsRequest) return base.deny(request, "worker_authority_boundary");
      if (!(await isWorkerFencingCurrent(pool, composition, binding.projectId, binding.goalId, binding.controlEpoch))) return base.deny(request, "worker_fence_stale");
      const expiry = composition.environment === undefined ? new Date(Date.now() + 5 * 60_000) : new Date(Math.min(Date.now() + 5 * 60_000, Date.parse(composition.environment.expiresAt)));
      if (expiry.getTime() <= Date.now()) return base.deny(request, "worker_environment_expired");
      await bootstrapAuthorityRecord(pool, { kind: "grant", commandId: null, projectId: request.projectId, goalId: request.goalId, actorId: request.actorId, action: request.action, target: request.target, policyVersion: request.policyVersion, budgetEffectCents: request.budgetEffectCents, expiresAt: expiry });
      return base.execute(request, async () => {
        if (!(await isWorkerFencingCurrent(pool, composition, binding.projectId, binding.goalId, binding.controlEpoch))) throw new Error("worker_fence_stale");
        await effect();
      });
    },
  };
}

/**
 * Worktree provisioning is Control Plane infrastructure, not a worker
 * capability. It is still authority-backed and limited to the exact local Git
 * operations needed to materialize the worker's durable workspace. The
 * resulting Git worktree is then verified before its append-only row is stored.
 */
function createWorkerWorktreeProvisioningAuthority(
  base: AuthorizedEffectExecutor,
  pool: Pool,
  binding: { readonly workspaceRoot: string; readonly operatorId: string; readonly projectId: string; readonly goalId: string; readonly commandId: string; readonly authorityPolicyVersion: number; readonly budgetEffectCents: number; readonly controlEpoch: string },
  composition: Pick<WorkerIpPythonComposition, "workerId" | "ownerId" | "fencingToken" | "repositoryPath">,
): { execute(request: ActionRequest, effect: () => Promise<unknown>): Promise<import("@maestro/authority").AuthorityDecision> } {
  const provisioningActions = new Set(["git.local.branch.create", "git.local.branch.remove", "git.local.worktree.create", "git.local.worktree.remove", "git.local.revision.read", "filesystem.directory.create"]);
  return {
    async execute(request, effect) {
      const allowed = request.projectId === binding.projectId && request.goalId === binding.goalId && request.actorId === binding.operatorId
        && request.policyVersion === binding.authorityPolicyVersion && request.budgetEffectCents === binding.budgetEffectCents
        && request.controlEpoch === binding.controlEpoch && provisioningActions.has(request.action) && classifyAction(request.action) === "ordinary";
      if (!allowed) return base.deny(request, "worker_worktree_provisioning_boundary");
      const compensatingCleanup = request.action === "git.local.worktree.remove" || request.action === "git.local.branch.remove";
      if (compensatingCleanup) {
        let targetParts: unknown;
        try { targetParts = JSON.parse(request.target); } catch { return base.deny(request, "worker_cleanup_target_invalid"); }
        if (!Array.isArray(targetParts) || targetParts[0] !== composition.repositoryPath || typeof composition.workerId !== "string") return base.deny(request, "worker_cleanup_target_mismatch");
        const expectedBranch = `worker/${composition.workerId}`;
        if (request.action === "git.local.branch.remove" && targetParts.length !== 2 || request.action === "git.local.worktree.remove" && targetParts.length !== 2) return base.deny(request, "worker_cleanup_target_mismatch");
        if (request.action === "git.local.branch.remove" && targetParts[1] !== expectedBranch) return base.deny(request, "worker_cleanup_target_mismatch");
        if (request.action === "git.local.worktree.remove" && targetParts[1] !== resolve(binding.workspaceRoot ?? "", "workers", composition.workerId)) return base.deny(request, "worker_cleanup_target_mismatch");
      }
      // Cleanup is allowed after lease turnover only for the exact worker-derived
      // branch/worktree already created by this provisioning attempt. It cannot
      // create, advance, commit, or read anything and remains durably journaled.
      if (!compensatingCleanup && !(await isWorkerFencingCurrent(pool, composition, binding.projectId, binding.goalId, binding.controlEpoch))) return base.deny(request, "worker_fence_stale");
      await bootstrapAuthorityRecord(pool, {
        kind: "grant", commandId: null, projectId: request.projectId, goalId: request.goalId, actorId: request.actorId,
        action: request.action, target: request.target, policyVersion: request.policyVersion,
        budgetEffectCents: request.budgetEffectCents, expiresAt: new Date(Date.now() + 5 * 60_000),
      });
      return base.execute(request, async () => {
        if (!compensatingCleanup && !(await isWorkerFencingCurrent(pool, composition, binding.projectId, binding.goalId, binding.controlEpoch))) throw new Error("worker_fence_stale");
        await effect();
      });
    },
  };
}

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

function ipPythonEffectAction(method: string): string | undefined {
  const actions: Readonly<Record<string, string>> = {
    read_file: "project.file.read",
    write_file: "project.file.edit",
    run_test: "project.test.run",
    run_shell: "project.shell.run",
    run_environment: "project.environment.change",
    git_revision: "git.local.revision.read",
    git_create_branch: "git.local.branch.create",
    git_create_worktree: "git.local.worktree.create",
    git_commit: "git.local.commit",
    git_advance_branch: "git.local.branch.advance",
    git_remove_worktree: "git.local.worktree.remove",
  };
  return actions[method];
}

function ipPythonPayloadDigest(request: IpPythonHostRequest): string {
  return createHash("sha256").update(JSON.stringify({ method: request.method, payload: request.payload }), "utf8").digest("hex");
}

function ipPythonStageDetails(boundary: IpPythonStageBoundary): Record<string, unknown> {
  return {
    stage: boundary.stage,
    outcome: boundary.outcome,
    blockDigest: boundary.blockDigest,
    ...(boundary.approvedBlockDigest === undefined ? {} : { approvedBlockDigest: boundary.approvedBlockDigest }),
    intentCount: boundary.intentCount,
    appliedCount: boundary.appliedCount,
    skippedCount: boundary.skippedCount,
    ...(boundary.reason === undefined ? {} : { reason: boundary.reason }),
  };
}

function ipPythonJournalDetails(binding: IpPythonSessionBinding, details: Record<string, unknown>): Record<string, unknown> {
  return { ...details, admissionCommandId: binding.admissionCommandId ?? binding.commandId, ...("workerId" in binding && typeof binding.workerId === "string" ? { workerId: binding.workerId } : {}) };
}

async function inspectIpPythonProcessOutcome(entry: IpPythonSessionJournalEntry): Promise<"reaped" | "unknown"> {
  const details = entry.details;
  const processGroupId = details.process_group_id;
  const processSessionId = details.process_session_id;
  const processStartTime = details.process_start_time;
  if (entry.processPid === null || typeof processGroupId !== "string" || typeof processSessionId !== "string" || typeof processStartTime !== "string") return "unknown";
  // A leader PID disappearing is not enough: the original detached group may
  // still contain a shell/test descendant. The runtime helper verifies the
  // captured group/session/start identity, terminates the matching group, and
  // returns `reaped` only after no owned member remains.
  return reapIpPythonProcessGroup({ processPid: entry.processPid, processGroupId, processSessionId, processStartTime });
}

function createHostNativeAdmission(config: MaestroConfig, input: NativeAdmissionInput): ExecutionAdmission {
  if (config.modelRoutingMode !== "pin") throw new Error("Native host admission requires pin routing mode");
  return createPinnedNativeAdmission(config, input);
}

export interface WorkerIpPythonComposition {
  readonly workerId?: string;
  readonly workspaceRoot?: string;
  /** Repository and immutable base used only to provision a real worker worktree. */
  readonly repositoryPath?: string;
  readonly baseRevision?: string;
  readonly ownerId?: string;
  readonly fencingToken?: string;
  readonly allowedTools?: readonly string[];
  readonly authorityBoundary?: readonly string[];
  readonly allowedPaths?: readonly string[];
  readonly workspaceBindingValid?: boolean;
  readonly environmentBindingValid?: boolean;
  readonly environment?: EnvironmentRecord;
}

/**
 * Resolve only durable worker-owned inputs for an IPython host session. A
 * command identity that is not a worker admission receives no composition,
 * which keeps conversation/Head/Encore sessions from inheriting worker state.
 * Environment records are accepted only while they are ready, unexpired, and
 * bound to the same Goal/project/worker identity.
 */
export async function resolveWorkerIpPythonComposition(
  pool: Pick<Pool, "query">,
  input: { readonly commandId: string; readonly projectId: string; readonly goalId: string; readonly trustedWorktreeRoot?: string },
  now: Date = new Date(),
): Promise<WorkerIpPythonComposition> {
  if (input.commandId.trim() === "" || input.projectId.trim() === "" || input.goalId.trim() === "") return {};
  const worker = await pool.query<{
    worker_id: string;
    goal_id: string;
    project_id: string;
    owner_id: string | null;
    owner_fencing_token: string | null;
    substance: unknown;
    repository_path: string | null;
    base_revision: string | null;
  }>(
    `SELECT w.worker_id, hc.goal_id, g.project_id, w.owner_id, w.owner_fencing_token, mb.substance,
            tc.content->'project'->>'repository' AS repository_path,
            tc.content->'project'->>'immutableBaseRevision' AS base_revision
       FROM workers w
       JOIN head_councils hc ON hc.council_id = w.council_id
       JOIN goals g ON g.goal_id = hc.goal_id
       LEFT JOIN task_contracts tc ON tc.contract_id = g.task_contract_id
       JOIN mission_bundles mb
         ON mb.council_id = w.council_id
        AND mb.department_id = w.department_id
        AND mb.plan_version = w.plan_version
        AND mb.item_id = w.item_id
      WHERE w.spawn_command_id = $1`,
    [input.commandId],
  );
  const row = worker.rows[0];
  if (row === undefined || row.project_id !== input.projectId || row.goal_id !== input.goalId) return {};
  const substance = row.substance !== null && typeof row.substance === "object" && !Array.isArray(row.substance)
    ? row.substance as { readonly allowedTools?: unknown; readonly allowedPaths?: unknown; readonly authorityBoundary?: unknown }
    : undefined;
  const allowedTools = Array.isArray(substance?.allowedTools) && substance.allowedTools.every((value) => typeof value === "string") ? substance.allowedTools as string[] : undefined;
  const allowedPaths = Array.isArray(substance?.allowedPaths) && substance.allowedPaths.every((value) => typeof value === "string") ? substance.allowedPaths as string[] : undefined;
  const authorityBoundary = Array.isArray(substance?.authorityBoundary) && substance.authorityBoundary.every((value) => typeof value === "string") ? substance.authorityBoundary as string[] : undefined;
  const repositoryPath = typeof row.repository_path === "string" && row.repository_path.trim() !== "" ? row.repository_path : undefined;
  const baseRevision = typeof row.base_revision === "string" && /^[0-9a-f]{40}$/.test(row.base_revision) ? row.base_revision : undefined;
  const result: WorkerIpPythonComposition = {
    workerId: row.worker_id,
    ...(repositoryPath === undefined ? {} : { repositoryPath }),
    ...(baseRevision === undefined ? {} : { baseRevision }),
    ...(row.owner_id === null ? {} : { ownerId: row.owner_id }),
    ...(row.owner_fencing_token === null ? {} : { fencingToken: row.owner_fencing_token }),
    ...(allowedTools === undefined ? {} : { allowedTools }),
    ...(allowedPaths === undefined ? {} : { allowedPaths }),
    ...(authorityBoundary === undefined ? {} : { authorityBoundary }),  };
  const worktree = await pool.query<{ repository_path?: string; worktree_path: string }>("SELECT repository_path, worktree_path FROM worker_worktrees WHERE worker_id = $1", [row.worker_id]);
  const worktreePath = worktree.rows[0]?.worktree_path;
  const durableRepositoryPath = typeof worktree.rows[0]?.repository_path === "string" && worktree.rows[0]!.repository_path.trim() !== "" ? worktree.rows[0]!.repository_path : result.repositoryPath;
  if (typeof worktreePath === "string" && worktreePath.trim() !== "") {
    if (!isAbsolute(worktreePath)) return { ...result, workspaceBindingValid: false };
    if (input.trustedWorktreeRoot !== undefined) {
      try {
        const trustedRoot = realpathSync.native(input.trustedWorktreeRoot);
        const actualWorktree = realpathSync.native(worktreePath);
        const remainder = relative(trustedRoot, actualWorktree);
        if (remainder === "" || remainder === ".." || remainder.startsWith(`..${sep}`) || isAbsolute(remainder)) return { ...result, workspaceBindingValid: false };
      } catch { return { ...result, workspaceBindingValid: false }; }
    }
    return await attachWorkerEnvironment(pool, row, { ...result, workspaceRoot: worktreePath, ...(durableRepositoryPath === undefined ? {} : { repositoryPath: durableRepositoryPath }) }, now);
  }
  return attachWorkerEnvironment(pool, row, durableRepositoryPath === undefined ? result : { ...result, repositoryPath: durableRepositoryPath }, now);
}

async function attachWorkerEnvironment(
  pool: Pick<Pool, "query">,
  worker: { readonly worker_id: string; readonly goal_id: string; readonly project_id: string; readonly substance: unknown },
  composition: WorkerIpPythonComposition,
  now: Date,
): Promise<WorkerIpPythonComposition> {
  const substance = worker.substance !== null && typeof worker.substance === "object" && !Array.isArray(worker.substance)
    ? worker.substance as { readonly environment?: unknown }
    : undefined;
  const declaredEnvironment = substance?.environment;
  if (declaredEnvironment === undefined) return composition;
  if (!Array.isArray(declaredEnvironment) || declaredEnvironment.length > 1 || declaredEnvironment.some((value) => typeof value !== "string" || value.trim() === "")) return { ...composition, environmentBindingValid: false };
  const environmentId = declaredEnvironment[0];
  if (environmentId === undefined) return composition;
  // A missing worktree is provisioned by the Control Plane before the durable
  // environment can be checked against its workspace. Re-resolve after that
  // authority-backed setup; never treat the pre-provisioning state as valid.
  if (composition.workspaceRoot === undefined) return composition;
  let environment: EnvironmentRecord | undefined;
  try { environment = await readEnvironment(pool, environmentId); }
  catch { return { ...composition, environmentBindingValid: false }; }
  if (environment === undefined || environment.state !== "ready" || Date.parse(environment.expiresAt) <= now.getTime()
    || environment.workerId !== composition.workerId || environment.goalId !== worker.goal_id || environment.projectId !== worker.project_id
    || environment.boundaries.filesystem.length === 0
    || !environment.boundaries.filesystem.some((scope) => {
      const filesystemRoot = isAbsolute(scope) ? resolve(scope) : resolve(composition.workspaceRoot!, scope);
      const remainder = relative(filesystemRoot, resolve(composition.workspaceRoot!));
      return remainder === "" || (remainder !== ".." && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder));
    })) return { ...composition, environmentBindingValid: false };
  return { ...composition, environment };
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
  const modelGateway = config.modelGatewayToken === undefined ? undefined : createModelGatewayClient({ baseUrl: config.modelGatewayUrl!, token: config.modelGatewayToken });
  const accountLoginStore = modelGateway === undefined ? undefined : createPostgresAccountLoginStore(pool);
  const accountLoginOwnerId = `${config.leaseOwnerId}:${randomUUID()}`;
  const authorityRepository = new PostgresAuthorityRepository(pool);
  const authorityExecutor = new AuthorizedEffectExecutor(authorityRepository);
  const ipythonSessions = createIpPythonSessionManager({
    createKernel: async (sessionId, binding) => {
      if (overrides.ipythonKernel !== undefined) return overrides.ipythonKernel;
      if (overrides.createIpPythonKernel !== undefined) return overrides.createIpPythonKernel(sessionId, binding);
      if (binding === undefined) throw new Error("IPython production kernel requires an authority binding");
      let composition: WorkerIpPythonComposition;
      try {
        composition = await resolveWorkerIpPythonComposition(pool, { commandId: (binding as IpPythonSessionBinding & { readonly admissionCommandId?: string }).admissionCommandId ?? binding.commandId, projectId: binding.projectId, goalId: binding.goalId, trustedWorktreeRoot: config.worktreeRoot });
      } catch {
        return createUnavailableIpPythonKernel("Worker IPython composition is unavailable");
      }
      if (composition.environmentBindingValid === false) return createUnavailableIpPythonKernel("Worker environment binding is unavailable");
      if (composition.workspaceBindingValid === false) return createUnavailableIpPythonKernel("Worker worktree binding is unavailable");
      const provisioningAuthority = createWorkerWorktreeProvisioningAuthority(authorityExecutor, pool, {
        workspaceRoot: config.worktreeRoot, operatorId: binding.operatorId, projectId: binding.projectId, goalId: binding.goalId, commandId: binding.commandId,
        authorityPolicyVersion: binding.authorityPolicyVersion, budgetEffectCents: binding.budgetEffectCents, controlEpoch: binding.controlEpoch,
      }, composition);
      const prepareDirectory = async (directory: string): Promise<void> => {
        const decision = await provisioningAuthority.execute({
          commandId: binding.commandId, projectId: binding.projectId, actorId: binding.operatorId,
          goalId: binding.goalId, action: "filesystem.directory.create", target: directory,
          policyVersion: binding.authorityPolicyVersion, budgetEffectCents: binding.budgetEffectCents, controlEpoch: binding.controlEpoch,
        }, async () => { await mkdir(directory, { recursive: true }); });
        if (decision.effect !== "allow") throw new Error(`Worker directory preparation denied: ${decision.reason}`);
      };
      if (composition.workerId === undefined || composition.workspaceRoot === undefined) {
        if (composition.workerId === undefined || !isAbsolute(config.worktreeRoot)) return createUnavailableIpPythonKernel("Worker worktree binding is unavailable");
        let repositoryPath: string | undefined;
        let provisioningGit: GitPort | undefined;
        let branchName: string | undefined;
        let derivedWorkspaceRoot: string | undefined;
        let worktreeCreated = false;
        let keepProvisionedResources = false;
        try {
          repositoryPath = composition.repositoryPath;
          const baseRevision = composition.baseRevision;
          if (repositoryPath === undefined || baseRevision === undefined || !isAbsolute(repositoryPath)) throw new Error("Worker repository binding is unavailable");
          derivedWorkspaceRoot = resolve(config.worktreeRoot, "workers", composition.workerId);
          if (!(await isWorkerFencingCurrent(pool, composition, binding.projectId, binding.goalId, binding.controlEpoch))) throw new Error("Worker fence is stale");
          await prepareDirectory(resolve(config.worktreeRoot, "workers"));
          provisioningGit = createLocalGitPort({
            authority: provisioningAuthority,
            context: { commandId: binding.commandId, projectId: binding.projectId, actorId: binding.operatorId, goalId: binding.goalId, policyVersion: binding.authorityPolicyVersion, budgetEffectCents: binding.budgetEffectCents, controlEpoch: binding.controlEpoch },
            workspaceRoot: config.worktreeRoot,
          });
          branchName = `worker/${composition.workerId}`;
          await provisioningGit.createBranch(repositoryPath, branchName, baseRevision);
          await provisioningGit.createWorktree(repositoryPath, derivedWorkspaceRoot, branchName);
          worktreeCreated = true;
          if (await provisioningGit.headRevision(derivedWorkspaceRoot) !== baseRevision) throw new Error("Worker worktree verification failed");
          if (!(await isWorkerFencingCurrent(pool, composition, binding.projectId, binding.goalId, binding.controlEpoch))) throw new Error("Worker fence is stale");
          let inserted: { readonly rowCount: number | null };
          try {
            inserted = await pool.query(
              `INSERT INTO worker_worktrees (worker_id, repository_path, worktree_path, branch_name, base_branch_name)
               VALUES ($1, $2, $3, $4, $5) ON CONFLICT (worker_id) DO NOTHING RETURNING worker_id`,
              [composition.workerId, repositoryPath, derivedWorkspaceRoot, branchName, "immutable-base"],
            );
          } catch (error) {
            // A lost database response makes resource ownership ambiguous; retain
            // the worktree for startup reconciliation instead of deleting it.
            keepProvisionedResources = true;
            throw error;
          }
          if (inserted.rowCount === 1) keepProvisionedResources = true;
          else {
            const existing = await pool.query<{ worktree_path: string; branch_name: string }>(
              "SELECT worktree_path, branch_name FROM worker_worktrees WHERE worker_id = $1", [composition.workerId],
            );
            if (existing.rows[0]?.worktree_path !== derivedWorkspaceRoot || existing.rows[0]?.branch_name !== branchName) throw new Error("Worker worktree binding conflict");
            keepProvisionedResources = true;
          }
          composition = await resolveWorkerIpPythonComposition(pool, { commandId: binding.admissionCommandId ?? binding.commandId, projectId: binding.projectId, goalId: binding.goalId, trustedWorktreeRoot: config.worktreeRoot });
        } catch {
          if (!keepProvisionedResources && repositoryPath !== undefined && provisioningGit !== undefined && branchName !== undefined) {
            if (worktreeCreated && derivedWorkspaceRoot !== undefined) await provisioningGit.removeWorktree(repositoryPath, derivedWorkspaceRoot).catch(() => undefined);
            const branchCleanup = provisioningGit.removeBranch?.(repositoryPath, branchName);
            if (branchCleanup !== undefined) await branchCleanup.catch(() => undefined);
          }
          return createUnavailableIpPythonKernel("Worker worktree binding is unavailable");
        }
      }
      if (composition.environmentBindingValid === false) return createUnavailableIpPythonKernel("Worker environment binding is unavailable");
      if (composition.workspaceBindingValid === false) return createUnavailableIpPythonKernel("Worker worktree binding is unavailable");
      if (composition.workerId === undefined || composition.workspaceRoot === undefined) return createUnavailableIpPythonKernel("Worker worktree binding is unavailable");
      if (composition.allowedPaths === undefined) return createUnavailableIpPythonKernel("Worker path scope is unavailable");
      if (!(await isWorkerFencingCurrent(pool, composition, binding.projectId, binding.goalId, binding.controlEpoch))) return createUnavailableIpPythonKernel("Worker fence is stale");
      for (const allowedPath of composition.allowedPaths) {
        if (allowedPath.trim() === "" || isAbsolute(allowedPath) || (allowedPath.split("/").some((part) => part === "..") || allowedPath.split("\\").some((part) => part === ".."))) return createUnavailableIpPythonKernel("Worker path scope is invalid");
        if (!(await isWorkerFencingCurrent(pool, composition, binding.projectId, binding.goalId, binding.controlEpoch))) return createUnavailableIpPythonKernel("Worker fence is stale");
        await prepareDirectory(resolve(composition.workspaceRoot, allowedPath));
      }
      const workerBinding: IpPythonSessionBinding & { readonly workerId: string } = { ...binding, workerId: composition.workerId, pathScope: composition.allowedPaths.map((allowedPath) => resolve(composition.workspaceRoot!, allowedPath)) };
      const processRef = `ipython:${randomUUID()}`;

      const twoStage = composition.environment !== undefined && composition.fencingToken !== undefined ? {
        fencingToken: composition.fencingToken,
        approve: async (effects: readonly IpPythonHostRequest[], blockDigest: string, currentBinding?: IpPythonSessionBinding) => {
          const effectBinding = currentBinding ?? binding;
          const actions = effects.map((effect) => ipPythonEffectAction(effect.method));
          let classification: ReturnType<typeof classifyHostEffects>;
          try {
            if (actions.some((action) => action === undefined)) throw new Error("unknown_host_effect");
            classification = classifyHostEffects(actions as string[], 0);
          } catch (error) {
            await appendCapabilityJournal(pool, {
              capabilityKind: "ipython", projectId: effectBinding.projectId, goalId: effectBinding.goalId, commandId: effectBinding.commandId,
              event: "rejection", details: ipPythonJournalDetails(effectBinding, { blockDigest, effectCount: effects.length, reason: error instanceof Error ? error.message : "host_effect_classification_failed", saferAlternative: "Use a declared, bounded IPython host method" }),
            });
            return false;
          }
          if (classification.tier === "automatic progress") {
            await appendCapabilityJournal(pool, {
              capabilityKind: "ipython", projectId: effectBinding.projectId, goalId: effectBinding.goalId, commandId: effectBinding.commandId,
              event: "approval", details: ipPythonJournalDetails(effectBinding, { blockDigest, tier: classification.tier, effectCount: effects.length }),
            });
            return { approvalId: `automatic:${blockDigest}`, blockDigest, fencingToken: composition.fencingToken! };
          }
          const approvals = await Promise.all(effects.map(async (effect) => pool.query<{ approval_id: string }>(
            `SELECT approval_id FROM capability_approvals
               WHERE capability_kind = 'ipython' AND project_id = $1 AND goal_id = $2 AND command_id = $3
                 AND action = $4 AND target = $5 AND policy_version = $6 AND control_epoch = $7
                 AND budget_effect_cents = $8 AND decision = 'approved' AND revoked_at IS NULL AND expires_at > clock_timestamp()
               ORDER BY created_at DESC LIMIT 1`,
            [effectBinding.projectId, effectBinding.goalId, effectBinding.commandId, ipPythonEffectAction(effect.method) ?? "unknown", ipPythonPayloadDigest(effect), effectBinding.authorityPolicyVersion, effectBinding.controlEpoch, effectBinding.budgetEffectCents],
          )));
          const approvalIds = approvals.map((result) => result.rows[0]?.approval_id).filter((value): value is string => value !== undefined);
          if (approvalIds.length !== effects.length) {
            await appendCapabilityJournal(pool, {
              capabilityKind: "ipython", projectId: effectBinding.projectId, goalId: effectBinding.goalId, commandId: effectBinding.commandId,
              event: "rejection", details: ipPythonJournalDetails(effectBinding, { blockDigest, tier: classification.tier, effectCount: effects.length, approvedEffectCount: approvalIds.length, saferAlternative: "Request the required Goal-scoped approval before retrying" }),
            });
            return false;
          }
          await appendCapabilityJournal(pool, {
            capabilityKind: "ipython", projectId: effectBinding.projectId, goalId: effectBinding.goalId, commandId: effectBinding.commandId,
            event: "approval", ...(approvalIds[0] === undefined ? {} : { approvalId: approvalIds[0] }), details: ipPythonJournalDetails(effectBinding, { blockDigest, tier: classification.tier, effectCount: effects.length, approvalCount: approvalIds.length }),
          });
          return { approvalId: approvalIds.join(","), blockDigest, fencingToken: composition.fencingToken! };
        },
        consumeApproval: async (approval: IpPythonBlockApproval, effects: readonly IpPythonHostRequest[], currentBinding?: IpPythonSessionBinding) => {
          const effectBinding = currentBinding ?? binding;
          if (approval.approvalId.startsWith("automatic:")) return true;
          const approvalIds = approval.approvalId.split(",");
          if (approvalIds.length !== effects.length) return false;
          const consumptionInputs = effects.map((effect, index) => {
            const action = ipPythonEffectAction(effect.method);
            const approvalId = approvalIds[index];
            if (action === undefined || approvalId === undefined) return undefined;
            return {
              approvalId, capabilityKind: "ipython" as const, projectId: effectBinding.projectId, goalId: effectBinding.goalId, commandId: effectBinding.commandId, ...(effectBinding.admissionCommandId === undefined ? {} : { admissionCommandId: effectBinding.admissionCommandId }),
              effectIndex: index, action, target: ipPythonPayloadDigest(effect), policyVersion: effectBinding.authorityPolicyVersion, controlEpoch: effectBinding.controlEpoch, budgetEffectCents: effectBinding.budgetEffectCents,
            };
          });
          if (consumptionInputs.some((input) => input === undefined)) return false;
          const consumed = await consumeCapabilityApprovals(pool, consumptionInputs as Array<NonNullable<(typeof consumptionInputs)[number]>>);
          return consumed.length === effects.length && consumed.every((result) => result.consumed);
        },
        isFencingCurrent: async (fencingToken: string) => fencingToken === composition.fencingToken && await isWorkerFencingCurrent(pool, composition, binding.projectId, binding.goalId, binding.controlEpoch),
        recordEffectResult: async (index: number, request: IpPythonHostRequest, effectResult: { readonly state: string; readonly reason?: string }, currentBinding?: IpPythonSessionBinding) => {
          const effectBinding = currentBinding ?? binding;
          await appendCapabilityJournal(pool, {
            capabilityKind: "ipython", projectId: effectBinding.projectId, goalId: effectBinding.goalId, commandId: effectBinding.commandId,
            event: "effect_result", details: ipPythonJournalDetails(effectBinding, { index, method: request.method, payloadDigest: ipPythonPayloadDigest(request), state: effectResult.state, ...(effectResult.reason === undefined ? {} : { reason: effectResult.reason }) }),
          });
        },
        recordStageBoundary: async (boundary: IpPythonStageBoundary, currentBinding?: IpPythonSessionBinding) => {
          const effectBinding = currentBinding ?? binding;
          await appendCapabilityJournal(pool, {
            capabilityKind: "ipython", projectId: effectBinding.projectId, goalId: effectBinding.goalId, commandId: effectBinding.commandId,
            event: boundary.outcome === "completed" ? "effect_result" : "failure", details: ipPythonJournalDetails(effectBinding, ipPythonStageDetails(boundary)),
          });
        },
      } : undefined;
      const composedKernel = createIpPythonProductionKernel({
        authority: createWorkerIpPythonAuthority(authorityExecutor, pool, {
          operatorId: binding.operatorId, projectId: binding.projectId, goalId: binding.goalId, commandId: binding.commandId,
          authorityPolicyVersion: binding.authorityPolicyVersion, budgetEffectCents: binding.budgetEffectCents, controlEpoch: binding.controlEpoch,
        }, composition),
        workspaceRoot: composition.workspaceRoot,
        pythonExecutable: config.ipythonPythonExecutable ?? "/usr/bin/python3",
        processRef,
        ...(twoStage === undefined ? {} : {
          localEnvironment: composition.environment,
          readEnvironment: async () => {
            const current = await readEnvironment(pool, composition.environment!.environmentId);
            if (current === undefined || current.workerId !== composition.workerId || current.goalId !== composition.environment!.goalId || current.projectId !== composition.environment!.projectId) return undefined;
            return current;
          },
          twoStage,
        }),
        onStarted: async (event) => {
          await recordIpPythonSessionStarted(pool, {
            sessionId,
            processRef: event.processRef,
            projectId: binding.projectId,
            goalId: binding.goalId,
            processPid: event.processPid,
            parentPid: event.parentPid,
            details: {
              ...(event.processGroupId === undefined ? {} : { process_group_id: event.processGroupId }),
              ...(event.processSessionId === undefined ? {} : { process_session_id: event.processSessionId }),
              ...(event.processStartTime === undefined ? {} : { process_start_time: event.processStartTime }),
              worker_id: composition.workerId,
            },
          });
        },
        onHostRequest: async (request, result, currentBinding) => {
          const effectBinding = currentBinding ?? workerBinding;
          await appendCapabilityJournal(pool, {
            capabilityKind: "ipython", projectId: effectBinding.projectId, goalId: effectBinding.goalId, commandId: effectBinding.commandId,
            event: "effect_result", details: ipPythonJournalDetails(effectBinding, { method: request.method, payloadDigest: ipPythonPayloadDigest(request), state: result.state, ...(result.reason === undefined ? {} : { reason: result.reason }) }),
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
            details: {
              ...(event.processGroupId === undefined ? {} : { process_group_id: event.processGroupId }),
              ...(event.processSessionId === undefined ? {} : { process_session_id: event.processSessionId }),
              ...(event.processStartTime === undefined ? {} : { process_start_time: event.processStartTime }),
              worker_id: composition.workerId,
            },
          });
        },
      }, sessionId, workerBinding);
      return {
        async execute(request: Parameters<IpPythonKernel["execute"]>[0]) {
          const requestBinding = request.binding === undefined ? workerBinding : { ...workerBinding, commandId: request.binding.commandId, toolCallId: request.binding.toolCallId };
          return composedKernel.execute({ ...request, binding: requestBinding });
        },
        ...(composedKernel.interrupt === undefined ? {} : { interrupt: composedKernel.interrupt }),
        ...(composedKernel.close === undefined ? {} : { close: composedKernel.close }),
      };
    },
  });
  overrides.onIpPythonSessionManager?.(ipythonSessions);
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
  const workerService = createWorkerService({ modelRoutingMode: config.modelRoutingMode, ...(config.nativeModelRef === undefined ? {} : { nativeModelRef: config.nativeModelRef }), pool, kernel: executionKernel, withGoalLease: goalService.withGoalLease!, ...(config.maxConcurrentWorkersPerProject === undefined ? {} : { maxConcurrentWorkersPerProject: config.maxConcurrentWorkersPerProject }) });
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
