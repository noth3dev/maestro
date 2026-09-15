import { createHash } from "node:crypto";
import { canonicalJson, type ImprovementClass } from "@maestro/domain";
import type { Pool, PoolClient, QueryResultRow } from "pg";

export const RELEASE_CHECKPOINT_SCHEMA_VERSION = 1 as const;
export const RELEASE_CANDIDATE_IMPROVEMENT_CLASSES = ["persona_axis", "routing_capability_axis"] as const;

export class ReleaseCheckpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseCheckpointError";
  }
}

export class ReleaseCheckpointValidationError extends ReleaseCheckpointError {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseCheckpointValidationError";
  }
}

export class ReleaseCheckpointConflictError extends ReleaseCheckpointError {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseCheckpointConflictError";
  }
}

export class ReleaseCheckpointNotFoundError extends ReleaseCheckpointError {
  constructor(candidateId: string) {
    super(`Release checkpoint was not found: ${candidateId}`);
    this.name = "ReleaseCheckpointNotFoundError";
  }
}

export interface ReleaseCandidateSchemaVersions {
  readonly contract: string;
  readonly event: string;
  /** SHA-256 of the ordered durable migration ledger. */
  readonly database: string;
  readonly authorityPolicy: string;
  readonly evidence: string;
}

export interface ReleaseCandidatePins {
  readonly node: string;
  readonly postgres: string;
  readonly modelGateway: string;
  readonly providerAdapters: string;
  readonly browser: string;
  /** SHA-256 of the exact repository package-lock.json bytes. */
  readonly packages: string;
}

export interface ReleaseCandidateImprovementClasses {
  readonly enabled: readonly ImprovementClass[];
  readonly disabled: readonly ImprovementClass[];
  readonly certified: readonly ImprovementClass[];
}

export interface ReleaseCandidateIdentityInput {
  readonly schemaVersions: ReleaseCandidateSchemaVersions;
  readonly pins: ReleaseCandidatePins;
  readonly configuration: Readonly<Record<string, string>>;
  /** SHA-256 of the additive database export for this candidate. */
  readonly databaseStateHash: string;
  readonly improvementClasses: ReleaseCandidateImprovementClasses;
}

export interface ReleaseCandidateIdentity extends ReleaseCandidateIdentityInput {
  readonly schemaVersion: typeof RELEASE_CHECKPOINT_SCHEMA_VERSION;
}

export interface ReleaseCheckpointInput {
  readonly identity: ReleaseCandidateIdentityInput;
  readonly databaseExportPath: string;
  readonly databaseExportSha256: string;
}

export interface ReleaseCheckpoint extends ReleaseCandidateIdentity {
  readonly candidateId: string;
  readonly databaseExportPath: string;
  readonly databaseExportSha256: string;
  readonly createdAt: string;
}

type Queryable = Pick<Pool | PoolClient, "query">;

interface ReleaseCheckpointRow extends QueryResultRow {
  candidate_id: string;
  identity: unknown;
  database_export_path: string;
  database_export_sha256: string;
  created_at: Date;
}

const SHA256 = /^[a-f0-9]{64}$/u;
const SINGLE_LINE = /^[^\r\n]+$/u;
const IDENTITY_FIELDS = ["schemaVersions", "pins", "configuration", "databaseStateHash", "improvementClasses"] as const;
const SCHEMA_VERSION_FIELDS = ["contract", "event", "database", "authorityPolicy", "evidence"] as const;
const PIN_FIELDS = ["node", "postgres", "modelGateway", "providerAdapters", "browser", "packages"] as const;

function text(value: unknown, field: string, maxLength = 512): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > maxLength || !SINGLE_LINE.test(value)) {
    throw new ReleaseCheckpointValidationError(`${field} must be a non-empty single-line value`);
  }
  return value.trim();
}

function hash(value: unknown, field: string): string {
  const normalized = text(value, field, 64).toLowerCase();
  if (!SHA256.test(normalized)) {
    throw new ReleaseCheckpointValidationError(`${field} must be a lowercase SHA-256 hash`);
  }
  return normalized;
}

function ownFieldNames(value: object, field: string): string[] {
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    throw new ReleaseCheckpointValidationError(`${field} contains unsupported symbol fields`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
      throw new ReleaseCheckpointValidationError(`${field} cannot contain accessor fields`);
    }
  }
  return keys as string[];
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ReleaseCheckpointValidationError(`${field} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ReleaseCheckpointValidationError(`${field} must be a plain object`);
  }
  ownFieldNames(value, field);
  return value as Record<string, unknown>;
}

function assertExactFields(value: Record<string, unknown>, fields: readonly string[], field: string): void {
  const actual = ownFieldNames(value, field).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new ReleaseCheckpointValidationError(`${field} must contain exactly the declared fields`);
  }
}

function classList(value: unknown, field: string): ImprovementClass[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new ReleaseCheckpointValidationError(`${field} must be a standard array`);
  }
  const arrayKeys = Reflect.ownKeys(value);
  if (arrayKeys.some((key) => typeof key !== "string" || (key !== "length" && !/^(0|[1-9]\d*)$/u.test(key)))) {
    throw new ReleaseCheckpointValidationError(`${field} contains unsupported array fields`);
  }
  const result = value.map((item) => text(item, `${field} entry`, 64));
  if (new Set(result).size !== result.length) {
    throw new ReleaseCheckpointValidationError(`${field} must not contain duplicate improvement classes`);
  }
  for (const item of result) {
    if (!(RELEASE_CANDIDATE_IMPROVEMENT_CLASSES as readonly string[]).includes(item)) {
      throw new ReleaseCheckpointValidationError(`${field} contains an unknown improvement class: ${item}`);
    }
  }
  return result.sort() as ImprovementClass[];
}

function validateClasses(value: unknown): ReleaseCandidateImprovementClasses {
  const input = record(value, "improvementClasses");
  assertExactFields(input, ["enabled", "disabled", "certified"], "improvementClasses");
  const enabled = classList(input.enabled, "improvementClasses.enabled");
  const disabled = classList(input.disabled, "improvementClasses.disabled");
  const certified = classList(input.certified, "improvementClasses.certified");
  const enabledSet = new Set(enabled);
  const disabledSet = new Set(disabled);
  for (const item of enabled) {
    if (disabledSet.has(item)) {
      throw new ReleaseCheckpointValidationError(`improvement class is both enabled and disabled: ${item}`);
    }
    if (!certified.includes(item)) {
      throw new ReleaseCheckpointValidationError("enabled improvement classes must be explicitly certified");
    }
  }
  for (const item of RELEASE_CANDIDATE_IMPROVEMENT_CLASSES) {
    if (!enabledSet.has(item) && !disabledSet.has(item)) {
      throw new ReleaseCheckpointValidationError("every improvement class must be explicitly enabled or disabled");
    }
  }
  return { enabled, disabled, certified };
}

function normalizeObject(value: unknown, field: string): Record<string, string> {
  const input = record(value, field);
  const result = Object.create(null) as Record<string, string>;
  const seenKeys = new Set<string>();
  for (const key of ownFieldNames(input, field)) {
    const item = input[key];
    const normalizedKey = text(key, `${field} key`, 128);
    if (["__proto__", "constructor", "prototype"].includes(normalizedKey)) {
      throw new ReleaseCheckpointValidationError(`${field} contains a reserved key`);
    }
    if (seenKeys.has(normalizedKey)) {
      throw new ReleaseCheckpointValidationError(`${field} contains colliding keys after normalization`);
    }
    seenKeys.add(normalizedKey);
    result[normalizedKey] = text(item, `${field}.${normalizedKey}`, 1024);
  }
  return result;
}

export function validateReleaseCandidateIdentity(input: ReleaseCandidateIdentityInput): ReleaseCandidateIdentity {
  const root = record(input, "release candidate identity");
  const rootFields = ownFieldNames(root, "release candidate identity").filter((key) => key !== "schemaVersion");
  const rootWithoutSchema = Object.create(null) as Record<string, unknown>;
  for (const key of rootFields) rootWithoutSchema[key] = root[key];
  assertExactFields(rootWithoutSchema, IDENTITY_FIELDS, "release candidate identity");
  if (Object.hasOwn(root, "schemaVersion") && root.schemaVersion !== RELEASE_CHECKPOINT_SCHEMA_VERSION) {
    throw new ReleaseCheckpointValidationError("schemaVersion is unsupported");
  }
  const schemaVersions = record(root.schemaVersions, "schemaVersions");
  assertExactFields(schemaVersions, SCHEMA_VERSION_FIELDS, "schemaVersions");
  const pins = record(root.pins, "pins");
  assertExactFields(pins, PIN_FIELDS, "pins");

  return {
    schemaVersion: RELEASE_CHECKPOINT_SCHEMA_VERSION,
    schemaVersions: {
      contract: text(schemaVersions.contract, "schemaVersions.contract"),
      event: text(schemaVersions.event, "schemaVersions.event"),
      database: hash(schemaVersions.database, "schemaVersions.database"),
      authorityPolicy: text(schemaVersions.authorityPolicy, "schemaVersions.authorityPolicy"),
      evidence: text(schemaVersions.evidence, "schemaVersions.evidence"),
    },
    pins: {
      node: text(pins.node, "pins.node"),
      postgres: text(pins.postgres, "pins.postgres"),
      modelGateway: text(pins.modelGateway, "pins.modelGateway"),
      providerAdapters: text(pins.providerAdapters, "pins.providerAdapters"),
      browser: text(pins.browser, "pins.browser"),
      packages: hash(pins.packages, "pins.packages"),
    },
    configuration: normalizeObject(root.configuration, "configuration"),
    databaseStateHash: hash(root.databaseStateHash, "databaseStateHash"),
    improvementClasses: validateClasses(root.improvementClasses),
  };
}

export function computeReleaseCandidateIdentity(input: ReleaseCandidateIdentityInput): string {
  const identity = validateReleaseCandidateIdentity(input);
  return createHash("sha256").update(canonicalJson(identity), "utf8").digest("hex");
}

function rowToCheckpoint(row: ReleaseCheckpointRow): ReleaseCheckpoint {
  const identity = validateReleaseCandidateIdentity(row.identity as ReleaseCandidateIdentityInput);
  const databaseExportSha256 = hash(row.database_export_sha256, "databaseExportSha256");
  const databaseExportPath = text(row.database_export_path, "databaseExportPath", 4096);
  const candidateId = computeReleaseCandidateIdentity(identity);
  if (row.candidate_id !== candidateId || identity.databaseStateHash !== databaseExportSha256) {
    throw new ReleaseCheckpointError("stored release checkpoint identity does not match its candidate or export");
  }
  if (!(row.created_at instanceof Date) || Number.isNaN(row.created_at.getTime())) {
    throw new ReleaseCheckpointError("stored release checkpoint timestamp is invalid");
  }
  return { ...identity, candidateId, databaseExportPath, databaseExportSha256, createdAt: row.created_at.toISOString() };
}

async function readRow(queryable: Queryable, candidateId: string): Promise<ReleaseCheckpointRow | null> {
  const result = await queryable.query<ReleaseCheckpointRow>(
    "SELECT candidate_id, identity, database_export_path, database_export_sha256, created_at FROM release_checkpoints WHERE candidate_id = $1",
    [candidateId],
  );
  return result.rows[0] ?? null;
}

export async function recordReleaseCheckpoint(pool: Pool, input: ReleaseCheckpointInput): Promise<ReleaseCheckpoint> {
  const identity = validateReleaseCandidateIdentity(input.identity);
  const databaseExportPath = text(input.databaseExportPath, "databaseExportPath", 4096);
  const databaseExportSha256 = hash(input.databaseExportSha256, "databaseExportSha256");
  if (identity.databaseStateHash !== databaseExportSha256) {
    throw new ReleaseCheckpointValidationError("databaseStateHash must equal databaseExportSha256");
  }
  const candidateId = computeReleaseCandidateIdentity(identity);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO release_checkpoints (candidate_id, identity, database_export_path, database_export_sha256)
       VALUES ($1, $2::jsonb, $3, $4)
       ON CONFLICT (candidate_id) DO NOTHING`,
      [candidateId, JSON.stringify(identity), databaseExportPath, databaseExportSha256],
    );
    const row = await readRow(client, candidateId);
    if (row === null) {
      throw new ReleaseCheckpointError("release checkpoint insert was not readable");
    }
    const checkpoint = rowToCheckpoint(row);
    if (checkpoint.databaseExportPath !== databaseExportPath || checkpoint.databaseExportSha256 !== databaseExportSha256) {
      throw new ReleaseCheckpointConflictError("Release checkpoint candidate already exists with different export identity");
    }
    await client.query("COMMIT");
    return checkpoint;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function readReleaseCheckpoint(pool: Pool, candidateId: string): Promise<ReleaseCheckpoint> {
  const normalized = hash(candidateId, "candidateId");
  const row = await readRow(pool, normalized);
  if (row === null) {
    throw new ReleaseCheckpointNotFoundError(normalized);
  }
  return rowToCheckpoint(row);
}
