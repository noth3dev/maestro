export const PROVIDER_FACTS_SCHEMA_VERSION = 1 as const;

export const PROVIDER_FACT_RETENTION_POLICIES = ["none", "transient", "persistent"] as const;
export type ProviderFactRetention = (typeof PROVIDER_FACT_RETENTION_POLICIES)[number];

export const PROVIDER_FACT_TRAINING_POLICIES = ["never", "opt-in", "always"] as const;
export type ProviderFactTrainingUse = (typeof PROVIDER_FACT_TRAINING_POLICIES)[number];

export interface ProviderFacts {
  readonly schemaVersion: typeof PROVIDER_FACTS_SCHEMA_VERSION;
  /** Maximum number of input tokens the provider declares for this model. */
  readonly contextCapacity: number;
  readonly pricing: {
    readonly inputPerMillionTokens: number;
    readonly outputPerMillionTokens: number;
  };
  readonly authentication: {
    readonly modes: readonly string[];
  };
  readonly dataPolicy: {
    readonly allowedDataClasses: readonly string[];
    readonly retention: ProviderFactRetention;
    readonly trainingUse: ProviderFactTrainingUse;
    readonly regions: readonly string[];
  };
  readonly modalities: readonly string[];
  readonly toolCalls: {
    readonly supported: boolean;
  };
  readonly provenance: {
    readonly source: string;
    readonly observedAt: string;
  };
}

export class ProviderFactsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderFactsValidationError";
  }
}

function object(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProviderFactsValidationError(`${name} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ProviderFactsValidationError(`${name} must be a plain object`);
  }
}

function ownDataProperties(value: Record<string, unknown>, allowed: readonly string[], name: string): Record<string, unknown> {
  const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key)) {
      throw new ProviderFactsValidationError(`${name} has unknown field ${String(key)}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new ProviderFactsValidationError(`${name} field ${key} must be an enumerable data property`);
    }
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function required(snapshot: Record<string, unknown>, fields: readonly string[], name: string): void {
  for (const field of fields) {
    if (!Object.hasOwn(snapshot, field)) {
      throw new ProviderFactsValidationError(`${name} field ${field} is required`);
    }
  }
}

function line(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "" || /[\r\n]/.test(value)) {
    throw new ProviderFactsValidationError(`${field} must be a non-empty single line`);
  }
}

function finiteNonNegative(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ProviderFactsValidationError(`${field} must be a finite non-negative number`);
  }
}

function positiveInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new ProviderFactsValidationError(`${field} must be a positive safe integer`);
  }
}

function strings(value: unknown, field: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new ProviderFactsValidationError(`${field} must be a non-empty standard Array`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
      throw new ProviderFactsValidationError(`${field} has an unknown field ${String(key)}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new ProviderFactsValidationError(`${field} entry ${key} must be an enumerable data property`);
    }
  }
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new ProviderFactsValidationError(`${field} must not be sparse`);
    }
    line(value[index], `${field}[${index}]`);
    if (seen.has(value[index])) {
      throw new ProviderFactsValidationError(`${field} must not contain duplicate values`);
    }
    seen.add(value[index]);
  }
}

function assertRetention(value: unknown): asserts value is ProviderFactRetention {
  if (!(PROVIDER_FACT_RETENTION_POLICIES as readonly unknown[]).includes(value)) {
    throw new ProviderFactsValidationError("Provider data-policy retention is invalid");
  }
}

function assertTrainingUse(value: unknown): asserts value is ProviderFactTrainingUse {
  if (!(PROVIDER_FACT_TRAINING_POLICIES as readonly unknown[]).includes(value)) {
    throw new ProviderFactsValidationError("Provider data-policy trainingUse is invalid");
  }
}

function assertValidProviderFactsValue(value: unknown): ProviderFacts {
  object(value, "Provider facts");
  const snapshot = ownDataProperties(
    value,
    ["schemaVersion", "contextCapacity", "pricing", "authentication", "dataPolicy", "modalities", "toolCalls", "provenance"],
    "Provider facts",
  );
  required(
    snapshot,
    ["schemaVersion", "contextCapacity", "pricing", "authentication", "dataPolicy", "modalities", "toolCalls", "provenance"],
    "Provider facts",
  );
  if (snapshot.schemaVersion !== PROVIDER_FACTS_SCHEMA_VERSION) {
    throw new ProviderFactsValidationError(`Provider facts schemaVersion must be ${PROVIDER_FACTS_SCHEMA_VERSION}`);
  }
  positiveInteger(snapshot.contextCapacity, "Provider facts contextCapacity");

  object(snapshot.pricing, "Provider facts pricing");
  const pricing = ownDataProperties(snapshot.pricing, ["inputPerMillionTokens", "outputPerMillionTokens"], "Provider facts pricing");
  required(pricing, ["inputPerMillionTokens", "outputPerMillionTokens"], "Provider facts pricing");
  finiteNonNegative(pricing.inputPerMillionTokens, "Provider facts input pricing");
  finiteNonNegative(pricing.outputPerMillionTokens, "Provider facts output pricing");

  object(snapshot.authentication, "Provider facts authentication");
  const authentication = ownDataProperties(snapshot.authentication, ["modes"], "Provider facts authentication");
  required(authentication, ["modes"], "Provider facts authentication");
  strings(authentication.modes, "Provider facts authentication modes");

  object(snapshot.dataPolicy, "Provider facts dataPolicy");
  const dataPolicy = ownDataProperties(
    snapshot.dataPolicy,
    ["allowedDataClasses", "retention", "trainingUse", "regions"],
    "Provider facts dataPolicy",
  );
  required(dataPolicy, ["allowedDataClasses", "retention", "trainingUse", "regions"], "Provider facts dataPolicy");
  strings(dataPolicy.allowedDataClasses, "Provider facts allowedDataClasses");
  assertRetention(dataPolicy.retention);
  assertTrainingUse(dataPolicy.trainingUse);
  strings(dataPolicy.regions, "Provider facts regions");

  strings(snapshot.modalities, "Provider facts modalities");

  object(snapshot.toolCalls, "Provider facts toolCalls");
  const toolCalls = ownDataProperties(snapshot.toolCalls, ["supported"], "Provider facts toolCalls");
  required(toolCalls, ["supported"], "Provider facts toolCalls");
  if (typeof toolCalls.supported !== "boolean") {
    throw new ProviderFactsValidationError("Provider facts toolCalls supported must be a boolean");
  }

  object(snapshot.provenance, "Provider facts provenance");
  const provenance = ownDataProperties(snapshot.provenance, ["source", "observedAt"], "Provider facts provenance");
  required(provenance, ["source", "observedAt"], "Provider facts provenance");
  line(provenance.source, "Provider facts provenance source");
  line(provenance.observedAt, "Provider facts provenance observedAt");

  return value as unknown as ProviderFacts;
}

export function assertValidProviderFacts(value: unknown): asserts value is ProviderFacts {
  assertValidProviderFactsValue(value);
}
