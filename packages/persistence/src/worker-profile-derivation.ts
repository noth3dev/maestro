import { deriveWorkerProfile, isTerminalWorkerStatus, PERSONA_AXES, type PersonaAxis, type WorkerProfileDerivation, type WorkerStatus } from "@maestro/domain";
import type { Pool } from "pg";
import { readActivePersonaProfile } from "./persona-profile.js";
import { readMissionBundle, readMissionPersonaOverlay } from "./mission-bundle.js";
import { getPermanentRole } from "./organization.js";

export class WorkerProfileDerivationPersistenceError extends Error {}
export class WorkerProfileNotFoundError extends WorkerProfileDerivationPersistenceError {}
export class WorkerProfileExpiredError extends WorkerProfileDerivationPersistenceError {}

export interface DeriveWorkerProfileForMissionRequest {
  readonly workerId: string;
  readonly councilId: string;
  readonly departmentId: string;
  readonly planVersion: number;
  readonly itemId: string;
  /** Opaque profile reference from the same Mission Bundle. */
  readonly profileRef: string;
  readonly roleId: string;
  readonly taskClass: string;
}
interface BoundRow { axis: PersonaAxis; floor_value: string; ceiling_value: string; }
interface WorkerBindingRow { status: string; }

async function readReviewedBounds(pool: Pool, roleId: string): Promise<{ floors: Partial<Record<PersonaAxis, number>>; ceilings: Partial<Record<PersonaAxis, number>> }> {
  const rows = await pool.query<BoundRow>("SELECT axis, floor_value::text, ceiling_value::text FROM role_persona_bounds WHERE role_id = $1 ORDER BY axis", [roleId]);
  if (rows.rowCount !== PERSONA_AXES.length) throw new WorkerProfileDerivationPersistenceError(`Reviewed persona bounds are incomplete for role: ${roleId}`);
  const floors: Partial<Record<PersonaAxis, number>> = {}; const ceilings: Partial<Record<PersonaAxis, number>> = {};
  for (const row of rows.rows) { floors[row.axis] = Number(row.floor_value); ceilings[row.axis] = Number(row.ceiling_value); }
  return { floors, ceilings };
}

/** Binds worker derivation to the real Mission Bundle, active Head profile, worker lifecycle, and reviewed role bounds. */
export async function deriveWorkerProfileForMission(pool: Pool, request: DeriveWorkerProfileForMissionRequest): Promise<WorkerProfileDerivation> {
  const bundle = await readMissionBundle(pool, request.councilId, request.departmentId, request.planVersion, request.itemId);
  if (bundle.substance.profileRef !== request.profileRef) throw new WorkerProfileDerivationPersistenceError("Worker profile reference does not match the Mission Bundle");
  const worker = await pool.query<WorkerBindingRow>(
    `SELECT status FROM workers WHERE worker_id = $1 AND council_id = $2 AND department_id = $3 AND plan_version = $4 AND item_id = $5`,
    [request.workerId, request.councilId, request.departmentId, request.planVersion, request.itemId],
  );
  if (worker.rowCount !== 1) throw new WorkerProfileNotFoundError(`Worker is not bound to the Mission Bundle: ${request.workerId}`);
  if (isTerminalWorkerStatus(worker.rows[0]!.status as WorkerStatus)) throw new WorkerProfileExpiredError(`Worker profile has expired with terminated Worker: ${request.workerId}`);
  const overlay = await readMissionPersonaOverlay(pool, request.councilId, request.departmentId, request.planVersion, request.itemId);
  const role = await getPermanentRole(pool, request.roleId);
  if (role === undefined) throw new WorkerProfileDerivationPersistenceError(`Permanent role not found: ${request.roleId}`);
  const active = await readActivePersonaProfile(pool, request.roleId, request.taskClass);
  const { floors, ceilings } = await readReviewedBounds(pool, request.roleId);
  const missionDelta: Partial<Record<PersonaAxis, number>> = {};
  for (const axis of PERSONA_AXES) missionDelta[axis] = overlay.persona[axis] - active.persona[axis];
  return deriveWorkerProfile({
    workerId: request.workerId, roleId: request.roleId, taskClass: request.taskClass,
    departmentBaseline: role.persona, taskClassTemplate: active.persona, headProfile: active.persona,
    missionOverlay: missionDelta, missionOverlayExpiresAt: overlay.expiresAt,
    assignmentRef: `mission-bundle:${request.councilId}/${request.departmentId}/${request.planVersion}/${request.itemId}`,
    roleFloors: floors, roleCeilings: ceilings,
  });
}
