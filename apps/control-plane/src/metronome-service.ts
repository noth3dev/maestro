import type { MetronomeCorrectionInput, MetronomeFindingList, MetronomeResolutionInput, MetronomeSafePauseInput, RaiseMetronomeChallengeInput } from "@maestro/contracts";
import { isMissionPersonaOverlayExpired, isTerminalWorkerStatus, METRONOME_ACTOR_ID, parsePersonaProfile, PERSONA_AXES, type PersonaAxis, type WorkerStatus } from "@maestro/domain";
import { observeGoalForMetronome, raiseMetronomeChallenge, requestMetronomeCorrection, requestMetronomeSafePause, resolveMetronomeChallenge, type MetronomeActorContext } from "@maestro/persistence";
import type { Pool } from "pg";

export interface WorkerOverlayChallengeInput {
  readonly projectId: string;
  readonly workerId: string;
  readonly roleId: string;
  /** Optional observation hint; the service always reloads the durable overlay. */
  readonly profile?: Readonly<Partial<Record<PersonaAxis, number>>>;
  readonly roleFloors?: Readonly<Partial<Record<PersonaAxis, number>>>;
  readonly roleCeilings?: Readonly<Partial<Record<PersonaAxis, number>>>;
  readonly evidenceReferences: readonly string[];
}
export class WorkerOverlayChallengeError extends Error { constructor(message: string) { super(message); this.name = "WorkerOverlayChallengeError"; } }
interface DurableWorkerOverlayRow { status: string; department_id: string; bundle_content_hash: string; content_hash: string; persona: unknown; expires_at: Date | string; }
interface DurablePersonaBoundRow { axis: PersonaAxis; floor_value: string | number; ceiling_value: string | number; }
export function findUnsafeWorkerOverlay(input: WorkerOverlayChallengeInput): readonly string[] {
  const violations: string[] = [];
  if (input.workerId.trim() === "" || input.roleId.trim() === "") violations.push("worker identity is missing");
  for (const axis of PERSONA_AXES) {
    const value = input.profile?.[axis];
    const floor = input.roleFloors?.[axis]; const ceiling = input.roleCeilings?.[axis];
    if (value === undefined && (floor !== undefined || ceiling !== undefined)) { violations.push(`${axis} is missing from the worker profile`); continue; }
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) { violations.push(`${axis} is outside normalized bounds`); continue; }
    if (floor !== undefined && (typeof floor !== "number" || !Number.isFinite(floor) || value < floor)) violations.push(`${axis} is below role floor`);
    if (ceiling !== undefined && (typeof ceiling !== "number" || !Number.isFinite(ceiling) || value > ceiling)) violations.push(`${axis} is above role ceiling`);
  }
  for (const axis of Object.keys(input.profile ?? {})) if (!PERSONA_AXES.includes(axis as PersonaAxis)) violations.push(`unknown persona axis: ${axis}`);
  return Object.freeze(violations);
}
export interface MetronomeService {
  scan(goalId: string, projectId: string, commandId: string): Promise<MetronomeFindingList>;
  raise(goalId: string, input: RaiseMetronomeChallengeInput, commandId: string): Promise<import("@maestro/persistence").MetronomeChallenge>;
  requestCorrection(challengeId: string, input: MetronomeCorrectionInput, commandId: string): Promise<import("@maestro/persistence").MetronomeChallenge>;
  requestSafePause(goalId: string, challengeId: string, input: MetronomeSafePauseInput, commandId: string): Promise<import("@maestro/persistence").MetronomeChallenge>;
  resolve(challengeId: string, input: MetronomeResolutionInput, commandId: string, operatorId: string): Promise<import("@maestro/persistence").MetronomeChallenge>;
  challengeWorkerOverlay(goalId: string, input: WorkerOverlayChallengeInput, commandId: string): Promise<import("@maestro/persistence").MetronomeChallenge>;
}
export interface MetronomeServiceDependencies {
  pool: Pool;
  withGoalLease: <T>(goalId: string, operation: (proof: import("@maestro/persistence").GoalLeaseProof) => Promise<T>) => Promise<T>;
}
export class MetronomeProjectMismatchError extends Error { constructor() { super("Metronome project does not match the Goal project"); this.name = "MetronomeProjectMismatchError"; } }

/** Metronome is a canonical system actor; an authenticated project member may request a scan, but cannot impersonate its findings identity. */
export function createMetronomeService(deps: MetronomeServiceDependencies): MetronomeService {
  const context = (commandId: string): MetronomeActorContext => ({ actorId: METRONOME_ACTOR_ID, sessionRef: `api:${commandId}`, commandId });
  async function assertProject(goalId: string, projectId: string): Promise<void> {
    const result = await deps.pool.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1", [goalId]);
    if (result.rowCount !== 1 || result.rows[0]!.project_id !== projectId) throw new MetronomeProjectMismatchError();
  }
  async function challengeGoal(challengeId: string, projectId: string): Promise<string> {
    const result = await deps.pool.query<{ goal_id: string; project_id: string }>(
      "SELECT c.goal_id, g.project_id FROM metronome_challenges c JOIN goals g ON g.goal_id = c.goal_id WHERE c.challenge_id = $1",
      [challengeId],
    );
    if (result.rowCount !== 1 || result.rows[0]!.project_id !== projectId) throw new MetronomeProjectMismatchError();
    return result.rows[0]!.goal_id;
  }
  return {
    async scan(goalId, projectId, commandId) {
      await assertProject(goalId, projectId);
      const observation = await deps.withGoalLease(goalId, (proof) => observeGoalForMetronome(deps.pool, goalId, proof, context(commandId)));
      // Keep the existing HTTP scan contract findings-only; the control-plane loop exposes the full approval observation.
      return { findings: observation.findings };
    },
    async raise(goalId, input, commandId) {
      await assertProject(goalId, input.projectId);
      return deps.withGoalLease(goalId, (proof) => raiseMetronomeChallenge(deps.pool, goalId, input.findingIds, { reason: input.reason, evidenceReferences: input.evidenceReferences }, proof, context(commandId)));
    },
    async requestCorrection(challengeId, input, commandId) {
      const goalId = await challengeGoal(challengeId, input.projectId);
      return deps.withGoalLease(goalId, (proof) => requestMetronomeCorrection(deps.pool, challengeId, input.correctionRequest, proof, context(commandId)));
    },
    async requestSafePause(goalId, challengeId, input, commandId) {
      await assertProject(goalId, input.projectId);
      return deps.withGoalLease(goalId, (proof) => requestMetronomeSafePause(deps.pool, challengeId, input.projectId, proof, context(commandId)));
    },
    async resolve(challengeId, input, commandId, operatorId) {
      const goalId = await challengeGoal(challengeId, input.projectId);
      const actor: MetronomeActorContext = { actorId: operatorId, sessionRef: `api:${commandId}`, commandId };
      return deps.withGoalLease(goalId, (proof) => resolveMetronomeChallenge(deps.pool, challengeId, operatorId, input.reason, proof, actor));
    },
    async challengeWorkerOverlay(goalId, input, commandId) {
      await assertProject(goalId, input.projectId);
      if (input.evidenceReferences.length === 0) throw new WorkerOverlayChallengeError("worker overlay challenge requires durable evidence references");
      const worker = await deps.pool.query<DurableWorkerOverlayRow>(
        `SELECT w.status, w.department_id, w.bundle_content_hash, b.content_hash, o.persona, o.expires_at
           FROM workers w
           JOIN mission_bundles b ON b.council_id = w.council_id AND b.department_id = w.department_id AND b.plan_version = w.plan_version AND b.item_id = w.item_id
           JOIN mission_persona_overlays o ON o.council_id = w.council_id AND o.department_id = w.department_id AND o.plan_version = w.plan_version AND o.item_id = w.item_id
           JOIN head_councils c ON c.council_id = w.council_id
          WHERE w.worker_id = $1 AND c.goal_id = $2`, [input.workerId, goalId],
      );
      if (worker.rowCount !== 1) throw new WorkerOverlayChallengeError("worker overlay is not bound to this Goal");
      const durableWorker = worker.rows[0]!;
      if (isTerminalWorkerStatus(durableWorker.status as WorkerStatus) || isMissionPersonaOverlayExpired({ expiresAt: new Date(durableWorker.expires_at).toISOString() }, new Date())) throw new WorkerOverlayChallengeError("worker overlay is no longer active");
      let profile;
      try { profile = parsePersonaProfile(durableWorker.persona); } catch { throw new WorkerOverlayChallengeError("stored worker overlay profile is invalid"); }
      const bounds = await deps.pool.query<DurablePersonaBoundRow>(
        `SELECT b.axis, b.floor_value::text, b.ceiling_value::text
           FROM role_persona_bounds b JOIN permanent_roles r ON r.role_id = b.role_id
          WHERE b.role_id = $1 AND r.role_kind = 'department_head' AND r.department_id = $2 ORDER BY b.axis`,
        [input.roleId, durableWorker.department_id],
      );
      if (bounds.rowCount !== PERSONA_AXES.length) throw new WorkerOverlayChallengeError("reviewed role bounds are incomplete");
      const roleFloors: Partial<Record<PersonaAxis, number>> = {}; const roleCeilings: Partial<Record<PersonaAxis, number>> = {};
      for (const bound of bounds.rows) { roleFloors[bound.axis] = Number(bound.floor_value); roleCeilings[bound.axis] = Number(bound.ceiling_value); }
      const violations = findUnsafeWorkerOverlay({ ...input, profile, roleFloors, roleCeilings });
      if (violations.length === 0) throw new WorkerOverlayChallengeError("worker overlay does not violate its reviewed role duty bounds");
      const reason = `Unsafe worker overlay ${input.workerId} (${input.roleId}): ${violations.join("; ")}`;
      return deps.withGoalLease(goalId, (proof) => raiseMetronomeChallenge(deps.pool, goalId, [], { reason, evidenceReferences: input.evidenceReferences, targetRef: input.workerId }, proof, context(commandId)));
    },
  };
}
