import {
  composePersonaProfile,
  extractPersonaCoreIdentity,
  parseLearnedPersonaProfileVersion,
  parseTaskClassPersonaAdjustment,
  PERSONA_AXES,
  type LearnedPersonaProfileVersion,
  type LearnedPersonaProfileVersionInput,
  type TaskClassPersonaAdjustment,
  type TaskClassPersonaAdjustmentInput,
  type PersonaAxis,
  type PersonaProfile,
  type ResolvedPersonaProfile,
} from "@maestro/domain";
import type { Pool, PoolClient } from "pg";
import { getPermanentRole } from "./organization.js";

export class PersonaProfileError extends Error {}
export class PersonaProfileNotFoundError extends PersonaProfileError {}
export class PersonaProfileVersionConflictError extends PersonaProfileError {}

interface LearnedProfileRow {
  role_id: string;
  version: number;
  profile: unknown;
  rationale: unknown;
  source: string;
}

interface AdjustmentRow {
  role_id: string;
  task_class: string;
  version: number;
  delta: unknown;
  reason: string;
}

function profileRecord(row: LearnedProfileRow): LearnedPersonaProfileVersion {
  return parseLearnedPersonaProfileVersion({ roleId: row.role_id, version: row.version, profile: row.profile, rationale: row.rationale, source: row.source });
}

function adjustmentRecord(row: AdjustmentRow): TaskClassPersonaAdjustment {
  return parseTaskClassPersonaAdjustment({ roleId: row.role_id, taskClass: row.task_class, version: row.version, delta: row.delta, reason: row.reason });
}

async function lockRole(client: PoolClient, roleId: string): Promise<NonNullable<Awaited<ReturnType<typeof getPermanentRole>>>> {
  const role = await client.query("SELECT role_id FROM permanent_roles WHERE role_id = $1 FOR UPDATE", [roleId]);
  if (role.rowCount !== 1) throw new PersonaProfileNotFoundError(`Permanent role not found: ${roleId}`);
  const loaded = await getPermanentRole(client, roleId);
  if (!loaded) throw new PersonaProfileNotFoundError(`Permanent role not found: ${roleId}`);
  return loaded;
}

function profilesEqual(left: PersonaProfile, right: PersonaProfile): boolean {
  return PERSONA_AXES.every((axis) => left[axis] === right[axis]);
}

/** Appends one immutable learned role profile version. Version one must preserve the reviewed role seed. */
export async function storeLearnedPersonaProfileVersion(pool: Pool, input: LearnedPersonaProfileVersionInput): Promise<LearnedPersonaProfileVersion> {
  const parsed = parseLearnedPersonaProfileVersion(input);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const role = await lockRole(client, parsed.roleId);
    if (parsed.version === 1 && !profilesEqual(parsed.profile, role.persona)) throw new PersonaProfileVersionConflictError("profile version one must equal the reviewed role seed");
    const existing = await client.query<LearnedProfileRow>(
      `SELECT role_id, version, profile, rationale, source FROM persona_profile_versions WHERE role_id = $1 AND version = $2`,
      [parsed.roleId, parsed.version],
    );
    if (existing.rowCount === 1) {
      const prior = profileRecord(existing.rows[0]!);
      if (JSON.stringify(prior) !== JSON.stringify(parsed)) throw new PersonaProfileVersionConflictError(`learned persona profile version already exists: ${parsed.roleId}/${parsed.version}`);
      await client.query("COMMIT");
      return prior;
    }
    const latest = await client.query<{ version: number }>("SELECT version FROM persona_profile_versions WHERE role_id = $1 ORDER BY version DESC LIMIT 1", [parsed.roleId]);
    const expected = (latest.rows[0]?.version ?? 0) + 1;
    if (parsed.version !== expected) throw new PersonaProfileVersionConflictError(`learned persona profile version must be ${expected}`);
    const inserted = await client.query<LearnedProfileRow>(
      `INSERT INTO persona_profile_versions (role_id, version, profile, rationale, source)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
       RETURNING role_id, version, profile, rationale, source`,
      [parsed.roleId, parsed.version, JSON.stringify(parsed.profile), JSON.stringify(parsed.rationale), parsed.source],
    );
    await client.query("COMMIT");
    return profileRecord(inserted.rows[0]!);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listLearnedPersonaProfileVersions(pool: Pool, roleId: string): Promise<readonly LearnedPersonaProfileVersion[]> {
  const result = await pool.query<LearnedProfileRow>(
    `SELECT role_id, version, profile, rationale, source FROM persona_profile_versions WHERE role_id = $1 ORDER BY version`, [roleId],
  );
  return result.rows.map(profileRecord);
}

/** Appends a task-class delta; it never updates the durable learned profile row. */
export async function storeTaskClassPersonaAdjustment(pool: Pool, input: TaskClassPersonaAdjustmentInput): Promise<TaskClassPersonaAdjustment> {
  const parsed = parseTaskClassPersonaAdjustment(input);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockRole(client, parsed.roleId);
    const profileResult = await client.query<LearnedProfileRow>(
      `SELECT role_id, version, profile, rationale, source FROM persona_profile_versions WHERE role_id = $1 ORDER BY version DESC LIMIT 1`, [parsed.roleId],
    );
    if (profileResult.rowCount !== 1) throw new PersonaProfileNotFoundError(`No learned persona profile for role: ${parsed.roleId}`);
    const baseline = profileRecord(profileResult.rows[0]!).profile;
    for (const axis of PERSONA_AXES) {
      const value = baseline[axis] + (parsed.delta[axis] ?? 0);
      if (value < 0 || value > 1) throw new PersonaProfileVersionConflictError(`task-class delta leaves ${axis} outside [0,1]`);
    }
    const existing = await client.query<AdjustmentRow>(
      `SELECT role_id, task_class, version, delta, reason FROM persona_task_class_adjustments WHERE role_id = $1 AND task_class = $2 AND version = $3`,
      [parsed.roleId, parsed.taskClass, parsed.version],
    );
    if (existing.rowCount === 1) {
      const prior = adjustmentRecord(existing.rows[0]!);
      if (JSON.stringify(prior) !== JSON.stringify(parsed)) throw new PersonaProfileVersionConflictError(`task-class adjustment version already exists: ${parsed.roleId}/${parsed.taskClass}/${parsed.version}`);
      await client.query("COMMIT");
      return prior;
    }
    const latest = await client.query<{ version: number }>(
      `SELECT version FROM persona_task_class_adjustments WHERE role_id = $1 AND task_class = $2 ORDER BY version DESC LIMIT 1`, [parsed.roleId, parsed.taskClass],
    );
    const expected = (latest.rows[0]?.version ?? 0) + 1;
    if (parsed.version !== expected) throw new PersonaProfileVersionConflictError(`task-class adjustment version must be ${expected}`);
    const inserted = await client.query<AdjustmentRow>(
      `INSERT INTO persona_task_class_adjustments (role_id, task_class, version, delta, reason)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING role_id, task_class, version, delta, reason`,
      [parsed.roleId, parsed.taskClass, parsed.version, JSON.stringify(parsed.delta), parsed.reason],
    );
    await client.query("COMMIT");
    return adjustmentRecord(inserted.rows[0]!);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function readActivePersonaProfile(pool: Pool, roleId: string, taskClass: string, missionOverlay: Readonly<Partial<Record<PersonaAxis, number>>> = {}): Promise<ResolvedPersonaProfile> {
  const role = await getPermanentRole(pool, roleId);
  if (!role) throw new PersonaProfileNotFoundError(`Permanent role not found: ${roleId}`);
  const profileResult = await pool.query<LearnedProfileRow>(
    `SELECT role_id, version, profile, rationale, source FROM persona_profile_versions WHERE role_id = $1 ORDER BY version DESC LIMIT 1`, [roleId],
  );
  if (profileResult.rowCount !== 1) throw new PersonaProfileNotFoundError(`No learned persona profile for role: ${roleId}`);
  const learned = profileRecord(profileResult.rows[0]!);
  const adjustmentResult = await pool.query<AdjustmentRow>(
    `SELECT role_id, task_class, version, delta, reason FROM persona_task_class_adjustments WHERE role_id = $1 AND task_class = $2 ORDER BY version DESC LIMIT 1`, [roleId, taskClass],
  );
  const adjustment = adjustmentResult.rowCount === 1
    ? adjustmentRecord(adjustmentResult.rows[0]!)
    : parseTaskClassPersonaAdjustment({ roleId, taskClass, version: 1, delta: {}, reason: "no task-class adjustment" });
  return composePersonaProfile(learned, adjustment, missionOverlay, extractPersonaCoreIdentity(role));
}
