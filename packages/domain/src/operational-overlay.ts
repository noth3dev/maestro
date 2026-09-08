/**
 * Project-private C (operations) state for the ensemble router.
 *
 * This module deliberately has no model identity or A/B policy fields. The
 * opaque candidateRef is resolved by the catalog/routing boundary; it is not
 * a provider/model identifier and cannot contain a provider-qualified path.
 */
export const OPERATIONAL_OVERLAY_SCHEMA_VERSION = 1 as const;
export const OPERATIONAL_RATE_MIN = 0 as const;
export const OPERATIONAL_RATE_MAX = 1 as const;

export interface OperationalObservation {
  /** Opaque local catalog key; never a provider/model identity. */
  readonly candidateRef: string;
  readonly measuredLatencyMs: number;
  readonly measuredCost: number;
  readonly failureRate: number;
  readonly timeoutRate: number;
  readonly providerErrorRate: number;
  /** Availability is false when the provider or bound account cannot serve. */
  readonly currentAvailability: boolean;
  /** Opaque account binding reference; null means no account is bound. */
  readonly accountBinding: string | null;
  readonly observedAt: string;
}

export interface OperationalOverlay {
  readonly schemaVersion: typeof OPERATIONAL_OVERLAY_SCHEMA_VERSION;
  readonly installationRef: string;
  readonly projectRef: string;
  readonly version: number;
  readonly observations: readonly OperationalObservation[];
}

/** A per-Goal copy of C state. It is not a routing or native-admission identity. */
export interface OperationalOverlaySnapshot {
  readonly schemaVersion: typeof OPERATIONAL_OVERLAY_SCHEMA_VERSION;
  readonly installationRef: string;
  readonly projectRef: string;
  readonly goalRef: string;
  readonly overlayVersion: number;
  readonly observations: readonly OperationalObservation[];
}

export class OperationalOverlayValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationalOverlayValidationError";
  }
}

type DataObject = Record<string, unknown>;

function object(value: unknown, name: string): asserts value is DataObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OperationalOverlayValidationError(`${name} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new OperationalOverlayValidationError(`${name} must be a plain object`);
  }
}

/** Read only own enumerable data properties. Accessors and hidden fields fail closed. */
function ownDataProperties(value: unknown, allowed: readonly string[], name: string): DataObject {
  object(value, name);
  const result: DataObject = Object.create(null) as DataObject;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key)) {
      throw new OperationalOverlayValidationError(`${name} has unknown field ${String(key)}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new OperationalOverlayValidationError(`${name} field ${key} must be an enumerable data property`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

function required(properties: DataObject, fields: readonly string[], name: string): void {
  for (const field of fields) {
    if (!Object.hasOwn(properties, field)) {
      throw new OperationalOverlayValidationError(`${name} field ${field} is required`);
    }
  }
}

function line(value: unknown, field: string, maximum = 256): asserts value is string {
  if (typeof value !== "string" || value.length > maximum || value.trim() === "" || /[\r\n]/.test(value)) {
    throw new OperationalOverlayValidationError(`${field} must be a non-empty single line`);
  }
}

function nonnegativeMeasurement(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new OperationalOverlayValidationError(`${field} must be a finite non-negative number`);
  }
}

function rate(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < OPERATIONAL_RATE_MIN || value > OPERATIONAL_RATE_MAX) {
    throw new OperationalOverlayValidationError(`${field} must be a finite number in [0,1]`);
  }
}

function version(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new OperationalOverlayValidationError(`${field} must be a positive safe integer`);
  }
}

function standardArray(value: unknown, name: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new OperationalOverlayValidationError(`${name} must use the standard Array prototype`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) {
      throw new OperationalOverlayValidationError(`${name} has unknown field ${String(key)}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new OperationalOverlayValidationError(`${name} entries must be enumerable data properties`);
    }
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) throw new OperationalOverlayValidationError(`${name} cannot be sparse`);
  }
  return value;
}

function timestamp(value: unknown, field: string): asserts value is string {
  line(value, field, 128);
  if (!Number.isFinite(Date.parse(value))) {
    throw new OperationalOverlayValidationError(`${field} must be a valid timestamp`);
  }
}

function opaqueCandidateRef(value: unknown): asserts value is string {
  line(value, "Operational observation candidateRef", 128);
  // Provider-qualified model identities use a slash. Candidate refs are local opaque keys.
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value)) {
    throw new OperationalOverlayValidationError("Operational observation candidateRef must be opaque");
  }
}

function validateObservation(value: unknown): OperationalObservation {
  const fields = [
    "candidateRef",
    "measuredLatencyMs",
    "measuredCost",
    "failureRate",
    "timeoutRate",
    "providerErrorRate",
    "currentAvailability",
    "accountBinding",
    "observedAt",
  ] as const;
  const properties = ownDataProperties(value, fields, "Operational observation");
  required(properties, fields, "Operational observation");
  opaqueCandidateRef(properties.candidateRef);
  nonnegativeMeasurement(properties.measuredLatencyMs, "Operational observation measuredLatencyMs");
  nonnegativeMeasurement(properties.measuredCost, "Operational observation measuredCost");
  rate(properties.failureRate, "Operational observation failureRate");
  rate(properties.timeoutRate, "Operational observation timeoutRate");
  rate(properties.providerErrorRate, "Operational observation providerErrorRate");
  if (typeof properties.currentAvailability !== "boolean") {
    throw new OperationalOverlayValidationError("Operational observation currentAvailability must be a boolean");
  }
  if (properties.accountBinding !== null) line(properties.accountBinding, "Operational observation accountBinding", 256);
  if (properties.currentAvailability && properties.accountBinding === null) {
    throw new OperationalOverlayValidationError("Operational observation available state requires an account binding");
  }
  timestamp(properties.observedAt, "Operational observation observedAt");
  return {
    candidateRef: properties.candidateRef as string,
    measuredLatencyMs: properties.measuredLatencyMs as number,
    measuredCost: properties.measuredCost as number,
    failureRate: properties.failureRate as number,
    timeoutRate: properties.timeoutRate as number,
    providerErrorRate: properties.providerErrorRate as number,
    currentAvailability: properties.currentAvailability as boolean,
    accountBinding: properties.accountBinding as string | null,
    observedAt: properties.observedAt as string,
  };
}

function validateOverlay(value: unknown): OperationalOverlay {
  const fields = ["schemaVersion", "installationRef", "projectRef", "version", "observations"] as const;
  const properties = ownDataProperties(value, fields, "Operational overlay");
  required(properties, fields, "Operational overlay");
  if (properties.schemaVersion !== OPERATIONAL_OVERLAY_SCHEMA_VERSION) {
    throw new OperationalOverlayValidationError(`Operational overlay schemaVersion must be ${OPERATIONAL_OVERLAY_SCHEMA_VERSION}`);
  }
  line(properties.installationRef, "Operational overlay installationRef");
  line(properties.projectRef, "Operational overlay projectRef");
  version(properties.version, "Operational overlay version");
  const observations = standardArray(properties.observations, "Operational overlay observations");
  const validated = observations.map((item) => validateObservation(item));
  const refs = new Set<string>();
  for (const item of validated) {
    if (refs.has(item.candidateRef))
      throw new OperationalOverlayValidationError("Operational overlay observations cannot duplicate candidateRef");
    refs.add(item.candidateRef);
  }
  return {
    schemaVersion: OPERATIONAL_OVERLAY_SCHEMA_VERSION,
    installationRef: properties.installationRef as string,
    projectRef: properties.projectRef as string,
    version: properties.version as number,
    observations: validated,
  };
}

function validOverlay(value: unknown): OperationalOverlay {
  try {
    return validateOverlay(value);
  } catch (error) {
    if (error instanceof OperationalOverlayValidationError) throw error;
    throw new OperationalOverlayValidationError("Operational overlay contains an unreadable value");
  }
}

export function assertValidOperationalOverlay(value: unknown): asserts value is OperationalOverlay {
  validOverlay(value);
}

export function assertValidOperationalOverlaySnapshot(value: unknown): asserts value is OperationalOverlaySnapshot {
  const properties = ownDataProperties(
    value,
    ["schemaVersion", "installationRef", "projectRef", "goalRef", "overlayVersion", "observations"],
    "Operational overlay snapshot",
  );
  required(
    properties,
    ["schemaVersion", "installationRef", "projectRef", "goalRef", "overlayVersion", "observations"],
    "Operational overlay snapshot",
  );
  line(properties.goalRef, "Operational overlay snapshot goalRef");
  validOverlay({
    schemaVersion: properties.schemaVersion,
    installationRef: properties.installationRef,
    projectRef: properties.projectRef,
    version: properties.overlayVersion,
    observations: properties.observations,
  });
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

/**
 * Copy the current installation/project overlay into an immutable Goal snapshot.
 * It reads no clock and mutates neither input nor shared state.
 */
export function snapshotOperationalOverlayForGoal(value: OperationalOverlay, goalRef: string): OperationalOverlaySnapshot {
  const overlay = validOverlay(value);
  line(goalRef, "Operational overlay snapshot goalRef");
  const observations = freeze(overlay.observations.map((item) => freeze({ ...item })));
  return freeze({
    schemaVersion: OPERATIONAL_OVERLAY_SCHEMA_VERSION,
    installationRef: overlay.installationRef,
    projectRef: overlay.projectRef,
    goalRef,
    overlayVersion: overlay.version,
    observations,
  });
}
