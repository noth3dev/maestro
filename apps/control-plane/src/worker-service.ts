import type { SpawnWorkerInput, Worker, WorkerMessageInput, WorkerObservation } from "@maestro/contracts";
import { toInvocationRef, type ToolEvents, type ExecutionKernelPort } from "@maestro/domain";
import { assertWorkspacePath } from "@maestro/git-adapter";
import { assertProjectRole, cancelWorker, countActiveWorkersForProject, getGoalControl, listCapabilityJournal, listIpPythonSessionJournalForGoal, observeWorker, readDepartmentPlan, readHeadCouncil, readWorker, sendWorkerMessageUnderOwnerClaim, spawnWorker, WorkerError, type CouncilActorContext, type OperatorContext } from "@maestro/persistence";
import type { Pool } from "pg";

export interface WorkerService {
  spawn(councilId: string, departmentId: string, input: SpawnWorkerInput, commandId: string, operator: OperatorContext): Promise<Worker>;
  get(workerId: string, projectId: string): Promise<Worker>;
  observe(workerId: string, projectId: string, commandId: string, operator: OperatorContext): Promise<WorkerObservation>;
  sendMessage(workerId: string, input: WorkerMessageInput, commandId: string, operator: OperatorContext): Promise<Worker>;
  cancel(workerId: string, projectId: string, commandId: string, operator: OperatorContext): Promise<Worker>;
}
export interface WorkerServiceDependencies {
  pool: Pool;
  /** Production ensemble admissions remain fail-closed until the full routed tuple is composed. */
  modelRoutingMode: "ensemble" | "pin";
  /** Host-owned fixed model for the explicit pin mode. */
  nativeModelRef?: string;
  kernel: ExecutionKernelPort;
  workspaceRoot?: string;
  withGoalLease: <T>(goalId: string, operation: (proof: import("@maestro/persistence").GoalLeaseProof) => Promise<T>) => Promise<T>;
  prepareWorkerWorktree?: (workerId: string, input: { projectId: string; repositoryPath: string; worktreePath: string }, operatorId: string, commandId: string) => Promise<{ worktreePath: string }>;
  /**
   * Phase 5 capacity-model first slice: a project-wide worker-slot ceiling. Absent by default
   * (unlimited, matching current behavior); set to enable admission control. A future revision
   * may partition this by risk class per roadmap/act-1-foundation/phase-05-concurrent-goals-portfolio.md's capacity model instead of one flat cap.
   */
  maxConcurrentWorkersPerProject?: number;
}
export class WorkerProjectMismatchError extends Error {
  constructor() { super("Worker project does not match the Council project"); this.name = "WorkerProjectMismatchError"; }
}
export class WorkerMessageRejectedError extends Error {
  constructor() { super("Worker cannot receive a follow-up message in its current state"); this.name = "WorkerMessageRejectedError"; }
}
export class WorkerCapacityExceededError extends Error {
  constructor(limit: number) { super(`Project worker capacity is exhausted (limit ${limit}); queue and retry once a worker slot frees`); this.name = "WorkerCapacityExceededError"; }
}
export class EnsembleRoutingUnavailableError extends Error {
  constructor() { super("Ensemble Router worker admission is not enabled"); this.name = "EnsembleRoutingUnavailableError"; }
}

export function assertWorkerRoutingMode(mode: "ensemble" | "pin"): void {
  if (mode === "ensemble") throw new EnsembleRoutingUnavailableError();
}

export function resolveWorkerModelForRouting(
  mode: "ensemble" | "pin",
  nativeModelRef: string | undefined,
  requestedModel: string | undefined,
): string | undefined {
  assertWorkerRoutingMode(mode);
  if (nativeModelRef === undefined) throw new Error("Pin worker admission requires MAESTRO_NATIVE_MODEL");
  if (requestedModel !== undefined && requestedModel !== nativeModelRef)
    throw new Error("Worker model does not match the configured pin identity");
  return nativeModelRef;
}

/** Keep provider/process ownership internals out of the current public Worker wire contract. */
function toApiWorker(worker: Awaited<ReturnType<typeof readWorker>>): Worker {
  return {
    workerId: worker.workerId, councilId: worker.councilId, departmentId: worker.departmentId, planVersion: worker.planVersion, itemId: worker.itemId,
    bundleContentHash: worker.bundleContentHash, attempt: worker.attempt, executionRef: worker.executionRef, invocationRef: worker.invocationRef,
    status: worker.status, answerText: worker.answerText, usageTotalTokens: worker.usageTotalTokens,
  };
}

function stopState(control: Awaited<ReturnType<typeof getGoalControl>>): WorkerObservation["observability"]["stopState"] {
  if (control.emergencyStoppedAt !== undefined) return "emergency_stopped";
  if (control.stoppedAt !== undefined) return "stopped";
  if (control.stoppingAt !== undefined) return "stopping";
  if (control.pausedAt !== undefined) return "paused";
  if (control.pauseRequestedAt !== undefined) return "pause_requested";
  return "open";
}

function iso(value: Date): string { return value.toISOString(); }

const OBSERVATION_DETAIL_KEYS = new Set(["blockDigest", "approvedBlockDigest", "stage", "outcome", "intentCount", "appliedCount", "skippedCount", "reason", "method", "payloadDigest", "state", "tier", "effectCount", "approvedEffectCount", "approvalCount", "saferAlternative", "admissionCommandId"]);
function redactedDetails(details: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(details).filter(([key, value]) => OBSERVATION_DETAIL_KEYS.has(key) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null)));
}

/** Worker creation derives the actor/session from the immutable Council snapshot and scopes the spawn with the Goal lease. */
export function createWorkerService(deps: WorkerServiceDependencies): WorkerService {
  return {
    async spawn(councilId, departmentId, input, commandId, operator) {
      await assertProjectRole(deps.pool, operator.operatorId, input.projectId, `head-${departmentId}`);
      const fixedModelRef = resolveWorkerModelForRouting(deps.modelRoutingMode, deps.nativeModelRef, input.model);
      if (deps.maxConcurrentWorkersPerProject !== undefined) {
        const active = await countActiveWorkersForProject(deps.pool, input.projectId);
        if (active >= deps.maxConcurrentWorkersPerProject) throw new WorkerCapacityExceededError(deps.maxConcurrentWorkersPerProject);
      }
      const council = await readHeadCouncil(deps.pool, councilId);
      if (council.snapshot.projectId !== input.projectId) throw new WorkerProjectMismatchError();
      const plan = await readDepartmentPlan(deps.pool, councilId, departmentId);
      if (plan.projectId !== input.projectId || plan.version !== input.planVersion) throw new WorkerProjectMismatchError();
      const participant = council.snapshot.participants.find((entry) => (entry.departmentId ?? entry.participantId) === departmentId);
      if (participant === undefined || participant.headRoleId === undefined || participant.departmentId === undefined) throw new Error("Department is not a captured Head Council participant");
      const context: CouncilActorContext = { actorId: participant.headRoleId, sessionRef: participant.sessionRef, commandId };
      if ((input.repositoryPath === undefined) !== (input.worktreePath === undefined)) throw new WorkerProjectMismatchError();
      const contractProject = council.snapshot.contract.content.project;
      const contractRepository = typeof contractProject === "object" && contractProject !== null && "repository" in contractProject && typeof contractProject.repository === "string" ? contractProject.repository : undefined;
      let canonicalRepositoryPath: string | undefined;
      if (input.repositoryPath !== undefined) {
        try {
          canonicalRepositoryPath = assertWorkspacePath(input.repositoryPath, "repositoryPath", deps.workspaceRoot);
          if (contractRepository === undefined || assertWorkspacePath(contractRepository, "contract repository", deps.workspaceRoot) !== canonicalRepositoryPath) throw new Error("repository mismatch");
        } catch { throw new WorkerProjectMismatchError(); }
      }
      const targetPreparation = input.worktreePath === undefined
        ? undefined
        : deps.prepareWorkerWorktree === undefined
          ? (() => { throw new WorkerError("Target-scoped worker preparation is not configured"); })
          : (workerId: string) => deps.prepareWorkerWorktree!(workerId, { projectId: input.projectId, repositoryPath: input.repositoryPath!, worktreePath: input.worktreePath! }, operator.operatorId, commandId).then((result) => result.worktreePath);
      return deps.withGoalLease(council.goalId, (proof) => spawnWorker(deps.pool, deps.kernel, { councilId, departmentId, planVersion: input.planVersion, itemId: input.itemId, commandId, ...(fixedModelRef === undefined ? {} : { modelRef: fixedModelRef }), ...(input.repositoryPath === undefined ? {} : { repositoryPath: canonicalRepositoryPath!, worktreePath: input.worktreePath! }), ...(targetPreparation === undefined ? {} : { prepareWorktree: targetPreparation }) }, proof, context).then(toApiWorker));
    },
    async get(workerId, projectId) {
      const worker = await readWorker(deps.pool, workerId);
      const council = await readHeadCouncil(deps.pool, worker.councilId);
      if (council.snapshot.projectId !== projectId) throw new WorkerProjectMismatchError();
      return toApiWorker(worker);
    },
    async observe(workerId, projectId, commandId, operator) {
      const worker = await readWorker(deps.pool, workerId);
      const council = await readHeadCouncil(deps.pool, worker.councilId);
      if (council.snapshot.projectId !== projectId) throw new WorkerProjectMismatchError();
      await assertProjectRole(deps.pool, operator.operatorId, projectId, `head-${worker.departmentId}`);
      const participant = council.snapshot.participants.find((entry) => (entry.departmentId ?? entry.participantId) === worker.departmentId);
      if (participant === undefined || participant.headRoleId === undefined || participant.departmentId === undefined) throw new Error("Worker department is not a captured Head participant");
      const context: CouncilActorContext = { actorId: participant.headRoleId, sessionRef: participant.sessionRef, commandId };
      return deps.withGoalLease(council.goalId, async (proof) => {
        let toolEvents: ToolEvents = { state: "unavailable", reason: "snapshot-unavailable" };
        try { toolEvents = await deps.kernel.getToolEvents(toInvocationRef(worker.invocationRef)); } catch { /* preserve redacted unavailable observability */ }
        const observed = await observeWorker(deps.pool, deps.kernel, workerId, proof, context);
        const workerCommand = await deps.pool.query<{ spawn_command_id: string | null }>("SELECT spawn_command_id FROM workers WHERE worker_id = $1", [workerId]);
        const spawnCommandId = workerCommand.rows[0]?.spawn_command_id;
        const [control, capabilityJournal, ipythonSessionJournal] = await Promise.all([
          getGoalControl(deps.pool, projectId, council.goalId),
          listCapabilityJournal(deps.pool, "ipython", projectId, council.goalId),
          listIpPythonSessionJournalForGoal(deps.pool, projectId, council.goalId),
        ]);
        return {
          ...toApiWorker(observed),
          observability: {
            stopState: stopState(control),
            capabilityJournal: capabilityJournal.filter((entry) => spawnCommandId !== undefined && (entry.commandId === spawnCommandId || entry.details.admissionCommandId === spawnCommandId)).map((entry) => ({ ...entry, details: redactedDetails(entry.details), ...(entry.approvalId === undefined ? {} : { approvalId: entry.approvalId }), ...(entry.commandId === undefined ? {} : { commandId: entry.commandId }), recordedAt: iso(entry.recordedAt) })),
            ipythonSessionJournal: ipythonSessionJournal.filter((entry) => entry.details.worker_id === workerId).map((entry) => ({ ...entry, details: redactedDetails(entry.details), occurredAt: iso(entry.occurredAt) })),
            toolEvents,
          },
        } satisfies WorkerObservation;
      });
    },
    async sendMessage(workerId, input, commandId, operator) {
      const worker = await readWorker(deps.pool, workerId);
      const council = await readHeadCouncil(deps.pool, worker.councilId);
      if (council.snapshot.projectId !== input.projectId) throw new WorkerProjectMismatchError();
      await assertProjectRole(deps.pool, operator.operatorId, input.projectId, `head-${worker.departmentId}`);
      const participant = council.snapshot.participants.find((entry) => (entry.departmentId ?? entry.participantId) === worker.departmentId);
      if (participant === undefined || participant.headRoleId === undefined || participant.departmentId === undefined) throw new Error("Department is not a captured Head participant");
      const delivered = await deps.withGoalLease(council.goalId, (proof) => sendWorkerMessageUnderOwnerClaim(deps.pool, deps.kernel, workerId, input.message, proof));
      if (!delivered) throw new WorkerMessageRejectedError();
      return toApiWorker(await readWorker(deps.pool, workerId));
    },
    async cancel(workerId, projectId, commandId, operator) {
      const worker = await readWorker(deps.pool, workerId);
      const council = await readHeadCouncil(deps.pool, worker.councilId);
      if (council.snapshot.projectId !== projectId) throw new WorkerProjectMismatchError();
      await assertProjectRole(deps.pool, operator.operatorId, projectId, `head-${worker.departmentId}`);
      const participant = council.snapshot.participants.find((entry) => (entry.departmentId ?? entry.participantId) === worker.departmentId);
      if (participant === undefined || participant.headRoleId === undefined || participant.departmentId === undefined) throw new Error("Worker department is not a captured Head participant");
      const context: CouncilActorContext = { actorId: participant.headRoleId, sessionRef: participant.sessionRef, commandId };
      return deps.withGoalLease(council.goalId, (proof) => cancelWorker(deps.pool, deps.kernel, workerId, proof, context).then(toApiWorker));
    },
  };
}
