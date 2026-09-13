import { z } from "zod";

export const PERSONA_AXES = [
  "agreeableness", "extraversion", "imagination", "realism", "conscientiousness",
  "caution", "initiative", "empathy", "adaptability", "sociability",
] as const;

export type PersonaAxis = (typeof PERSONA_AXES)[number];
export type PersonaProfile = Readonly<Record<PersonaAxis, number>>;

const normalizedAxis = z.number().finite().min(0).max(1);
export const personaProfileSchema = z.object({
  agreeableness: normalizedAxis,
  extraversion: normalizedAxis,
  imagination: normalizedAxis,
  realism: normalizedAxis,
  conscientiousness: normalizedAxis,
  caution: normalizedAxis,
  initiative: normalizedAxis,
  empathy: normalizedAxis,
  adaptability: normalizedAxis,
  sociability: normalizedAxis,
}).strict();

/** Validates a complete profile; partial overlays are deliberately outside this durable slice. */
export function parsePersonaProfile(value: unknown): PersonaProfile {
  return personaProfileSchema.parse(value);
}

export const CONCERTMASTER_PERSONA_BASELINE: PersonaProfile = Object.freeze({
  agreeableness: 0.70,
  extraversion: 0.75,
  imagination: 0.65,
  realism: 0.90,
  conscientiousness: 0.95,
  caution: 0.90,
  initiative: 0.92,
  empathy: 0.85,
  adaptability: 0.88,
  sociability: 0.82,
});


export interface PersonaValueRationale {
  readonly reason: string;
  readonly low: string;
  readonly current: string;
  readonly high: string;
}

export interface LearnedPersonaProfileVersionInput {
  readonly roleId: string;
  readonly version: number;
  readonly profile: PersonaProfile;
  readonly rationale: Readonly<Record<PersonaAxis, PersonaValueRationale>>;
  readonly source: string;
}

export type LearnedPersonaProfileVersion = LearnedPersonaProfileVersionInput;

export interface TaskClassPersonaAdjustmentInput {
  readonly roleId: string;
  readonly taskClass: string;
  readonly version: number;
  /** Signed deltas, applied to the learned profile for this task class. */
  readonly delta: Readonly<Partial<Record<PersonaAxis, number>>>;
  readonly reason: string;
}

export type TaskClassPersonaAdjustment = TaskClassPersonaAdjustmentInput;

/** Fixed role identity. Adaptive profile writes do not contain this shape. */
export interface PersonaCoreIdentity {
  readonly mission: string;
  readonly authority: readonly string[];
  readonly truthfulness: string;
  readonly safety: string;
  readonly prohibitedBehavior: readonly string[];
}

export interface PersonaCoreIdentitySource {
  readonly roleId: string;
  readonly charter: string;
  readonly capabilityBoundary: { readonly allowed: readonly string[]; readonly forbidden: readonly string[] };
}

export type PersonaLayerDelta = Readonly<Partial<Record<PersonaAxis, number>>>;

export interface ResolvedPersonaProfile {
  readonly persona: PersonaProfile;
  readonly coreIdentity: PersonaCoreIdentity | null;
  readonly layers: {
    readonly coreIdentity: PersonaCoreIdentity | null;
    readonly learnedProfile: LearnedPersonaProfileVersion;
    readonly taskClassAdjustment: TaskClassPersonaAdjustment;
    readonly missionOverlay: PersonaLayerDelta;
  };
}

export class InvalidPersonaProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPersonaProfileError";
  }
}

function profileObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidPersonaProfileError(`${name} must be an object`);
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new InvalidPersonaProfileError(`${name} must be a plain object`);
  return value as Record<string, unknown>;
}

function nonEmptyText(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "" || /[\r\n]/.test(value)) throw new InvalidPersonaProfileError(`${field} must be a non-empty single-line string`);
}

function positiveVersion(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new InvalidPersonaProfileError(`${field} must be a positive safe integer`);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], name: string): void {
  for (const key of Reflect.ownKeys(value)) if (typeof key !== "string" || !keys.includes(key)) throw new InvalidPersonaProfileError(`${name} has unknown field ${String(key)}`);
}

function immutableProfile(value: unknown, name: string): PersonaProfile {
  try {
    return Object.freeze({ ...parsePersonaProfile(value) });
  } catch {
    throw new InvalidPersonaProfileError(`${name} must contain exactly the ten normalized persona axes`);
  }
}

function parseRationale(value: unknown): Readonly<Record<PersonaAxis, PersonaValueRationale>> {
  const record = profileObject(value, "Persona rationale");
  exactKeys(record, PERSONA_AXES, "Persona rationale");
  const result = {} as Record<PersonaAxis, PersonaValueRationale>;
  for (const axis of PERSONA_AXES) {
    const item = profileObject(record[axis], `Persona rationale ${axis}`);
    exactKeys(item, ["reason", "low", "current", "high"], `Persona rationale ${axis}`);
    const reason = item.reason; const low = item.low; const current = item.current; const high = item.high;
    nonEmptyText(reason, `Persona rationale ${axis}.reason`);
    nonEmptyText(low, `Persona rationale ${axis}.low`);
    nonEmptyText(current, `Persona rationale ${axis}.current`);
    nonEmptyText(high, `Persona rationale ${axis}.high`);
    result[axis] = Object.freeze({ reason, low, current, high });
  }
  return Object.freeze(result);
}

export function parseLearnedPersonaProfileVersion(value: unknown): LearnedPersonaProfileVersion {
  const record = profileObject(value, "Learned persona profile version");
  exactKeys(record, ["roleId", "version", "profile", "rationale", "source"], "Learned persona profile version");
  nonEmptyText(record.roleId, "Learned persona profile roleId");
  positiveVersion(record.version, "Learned persona profile version");
  nonEmptyText(record.source, "Learned persona profile source");
  const profile = immutableProfile(record.profile, "Learned persona profile");
  return Object.freeze({ roleId: record.roleId, version: record.version, profile, rationale: parseRationale(record.rationale), source: record.source });
}

function parseDelta(value: unknown, name: string): PersonaLayerDelta {
  const record = profileObject(value, name);
  if (Object.keys(record).length > 2) throw new InvalidPersonaProfileError(`${name} must change at most two persona axes`);
  const result: Partial<Record<PersonaAxis, number>> = {};
  for (const key of Object.keys(record)) {
    if (!PERSONA_AXES.includes(key as PersonaAxis)) throw new InvalidPersonaProfileError(`${name} contains an unknown persona axis ${key}`);
    const number = record[key];
    if (typeof number !== "number" || !Number.isFinite(number) || number < -1 || number > 1) throw new InvalidPersonaProfileError(`${name}.${key} must be a finite delta in [-1,1]`);
    result[key as PersonaAxis] = number;
  }
  return Object.freeze(result);
}

export function parseTaskClassPersonaAdjustment(value: unknown): TaskClassPersonaAdjustment {
  const record = profileObject(value, "Task-class persona adjustment");
  exactKeys(record, ["roleId", "taskClass", "version", "delta", "reason"], "Task-class persona adjustment");
  nonEmptyText(record.roleId, "Task-class persona adjustment roleId");
  nonEmptyText(record.taskClass, "Task-class persona adjustment taskClass");
  positiveVersion(record.version, "Task-class persona adjustment version");
  nonEmptyText(record.reason, "Task-class persona adjustment reason");
  return Object.freeze({ roleId: record.roleId, taskClass: record.taskClass, version: record.version, delta: parseDelta(record.delta, "Task-class persona adjustment delta"), reason: record.reason });
}

export function extractPersonaCoreIdentity(source: PersonaCoreIdentitySource): PersonaCoreIdentity {
  nonEmptyText(source.charter, "Persona core mission");
  if (!source.capabilityBoundary || !Array.isArray(source.capabilityBoundary.allowed) || !Array.isArray(source.capabilityBoundary.forbidden)) throw new InvalidPersonaProfileError("Persona core authority boundary is required");
  const authority = source.capabilityBoundary.allowed.map((item) => { nonEmptyText(item, "Persona core authority"); return item; });
  const prohibitedBehavior = source.capabilityBoundary.forbidden.map((item) => { nonEmptyText(item, "Persona core prohibited behavior"); return item; });
  return Object.freeze({
    mission: source.charter,
    authority: Object.freeze([...authority]),
    truthfulness: "report evidence accurately",
    safety: "preserve safety and escalation boundaries",
    prohibitedBehavior: Object.freeze([...prohibitedBehavior]),
  });
}

export function composePersonaProfile(
  learnedProfile: LearnedPersonaProfileVersion,
  taskClassAdjustment: TaskClassPersonaAdjustment,
  missionOverlay: PersonaLayerDelta = {},
  coreIdentity: PersonaCoreIdentity | null = null,
): ResolvedPersonaProfile {
  const learned = parseLearnedPersonaProfileVersion(learnedProfile);
  const adjustment = parseTaskClassPersonaAdjustment(taskClassAdjustment);
  const overlay = parseDelta(missionOverlay, "Mission persona overlay");
  if (learned.roleId !== adjustment.roleId) throw new InvalidPersonaProfileError("Persona layers must target the same role");
  const values = { ...learned.profile } as Record<PersonaAxis, number>;
  for (const axis of PERSONA_AXES) {
    const value = values[axis] + (adjustment.delta[axis] ?? 0) + (overlay[axis] ?? 0);
    if (value < 0 || value > 1) throw new InvalidPersonaProfileError(`Composed persona ${axis} leaves [0,1]`);
    values[axis] = value;
  }
  const frozenCore = coreIdentity === null ? null : Object.freeze({
    mission: coreIdentity.mission, authority: Object.freeze([...coreIdentity.authority]), truthfulness: coreIdentity.truthfulness,
    safety: coreIdentity.safety, prohibitedBehavior: Object.freeze([...coreIdentity.prohibitedBehavior]),
  });
  return Object.freeze({
    persona: Object.freeze(values), coreIdentity: frozenCore,
    layers: Object.freeze({ coreIdentity: frozenCore, learnedProfile: learned, taskClassAdjustment: adjustment, missionOverlay: overlay }),
  });
}
