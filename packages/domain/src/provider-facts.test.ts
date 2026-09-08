import { describe, expect, it } from "vitest";
import {
  PROVIDER_FACTS_SCHEMA_VERSION,
  ProviderFactsValidationError,
  assertValidProviderFacts,
  type ProviderFacts,
} from "./provider-facts.js";

function facts(overrides: Partial<ProviderFacts> = {}): ProviderFacts {
  return {
    schemaVersion: PROVIDER_FACTS_SCHEMA_VERSION,
    contextCapacity: 128_000,
    pricing: { inputPerMillionTokens: 2.5, outputPerMillionTokens: 10 },
    authentication: { modes: ["api-key", "managed-subscription"] },
    dataPolicy: {
      allowedDataClasses: ["public", "internal"],
      retention: "transient",
      trainingUse: "never",
      regions: ["us"],
    },
    modalities: ["text", "image"],
    toolCalls: { supported: true },
    provenance: { source: "provider-docs:model-1", observedAt: "2026-09-08" },
    ...overrides,
  };
}

describe("provider-declared facts", () => {
  it("accepts the complete hard-fact contract", () => {
    expect(() => assertValidProviderFacts(facts())).not.toThrow();
  });

  it("requires a positive safe-integer context capacity", () => {
    expect(() => assertValidProviderFacts(facts({ contextCapacity: 0 }))).toThrow(ProviderFactsValidationError);
    expect(() => assertValidProviderFacts(facts({ contextCapacity: 1.5 }))).toThrow(ProviderFactsValidationError);
    expect(() => assertValidProviderFacts(facts({ contextCapacity: Number.POSITIVE_INFINITY }))).toThrow(ProviderFactsValidationError);
  });

  it("requires finite non-negative input and output prices", () => {
    expect(() => assertValidProviderFacts(facts({ pricing: { inputPerMillionTokens: -1, outputPerMillionTokens: 2 } }))).toThrow(
      ProviderFactsValidationError,
    );
    expect(() => assertValidProviderFacts(facts({ pricing: { inputPerMillionTokens: 1, outputPerMillionTokens: Number.NaN } }))).toThrow(
      ProviderFactsValidationError,
    );
  });

  it("requires authentication modes, policy classes, and modalities to be non-empty unique lines", () => {
    expect(() => assertValidProviderFacts(facts({ authentication: { modes: [] } }))).toThrow(ProviderFactsValidationError);
    expect(() => assertValidProviderFacts(facts({ authentication: { modes: ["api-key", "api-key"] } }))).toThrow(
      ProviderFactsValidationError,
    );
    expect(() =>
      assertValidProviderFacts(facts({ dataPolicy: { ...facts().dataPolicy, allowedDataClasses: ["public", "two\nlines"] } })),
    ).toThrow(ProviderFactsValidationError);
    expect(() => assertValidProviderFacts(facts({ modalities: ["text", ""] }))).toThrow(ProviderFactsValidationError);
  });

  it("requires the explicit data-policy fields and supported tool-call boolean", () => {
    const policy = { ...facts().dataPolicy } as Record<string, unknown>;
    delete policy.regions;
    expect(() => assertValidProviderFacts(facts({ dataPolicy: policy as ProviderFacts["dataPolicy"] }))).toThrow(
      ProviderFactsValidationError,
    );
    expect(() => assertValidProviderFacts(facts({ dataPolicy: { ...facts().dataPolicy, trainingUse: "maybe" as never } }))).toThrow(
      ProviderFactsValidationError,
    );
    expect(() => assertValidProviderFacts(facts({ toolCalls: { supported: "yes" as never } }))).toThrow(ProviderFactsValidationError);
  });

  it("rejects malformed versions, unknown fields, and score-like capability fields", () => {
    expect(() => assertValidProviderFacts(facts({ schemaVersion: 99 as never }))).toThrow(ProviderFactsValidationError);
    expect(() => assertValidProviderFacts({ ...facts(), reasoning: 100 })).toThrow(ProviderFactsValidationError);
    expect(() => assertValidProviderFacts({ ...facts(), extra: true })).toThrow(ProviderFactsValidationError);
    expect(() => assertValidProviderFacts({ ...facts(), pricing: { ...facts().pricing, currency: "USD" } })).toThrow(
      ProviderFactsValidationError,
    );
  });

  it("rejects inherited, symbol, non-enumerable, accessor, and sparse extras", () => {
    const inherited = facts() as Record<string, unknown>;
    Object.setPrototypeOf(inherited, { provider: "openai" });
    expect(() => assertValidProviderFacts(inherited)).toThrow(ProviderFactsValidationError);

    const hidden = facts() as Record<string, unknown>;
    Object.defineProperty(hidden, "provider", { value: "openai", enumerable: false });
    expect(() => assertValidProviderFacts(hidden)).toThrow(ProviderFactsValidationError);

    const symbol = facts() as Record<string | symbol, unknown>;
    symbol[Symbol("provider")] = "openai";
    expect(() => assertValidProviderFacts(symbol)).toThrow(ProviderFactsValidationError);

    const accessor = facts() as Record<string, unknown>;
    Object.defineProperty(accessor, "contextCapacity", { get: () => 128_000, enumerable: true });
    expect(() => assertValidProviderFacts(accessor)).toThrow(ProviderFactsValidationError);

    const sparse = ["text", "image"];
    delete sparse[0];
    expect(() => assertValidProviderFacts(facts({ modalities: sparse }))).toThrow(ProviderFactsValidationError);
  });

  it("rejects non-plain nested values and missing required keys", () => {
    expect(() => assertValidProviderFacts(facts({ pricing: [] as never }))).toThrow(ProviderFactsValidationError);
    expect(() => assertValidProviderFacts(facts({ dataPolicy: Object.create({ regions: ["us"] }) }))).toThrow(ProviderFactsValidationError);
    const missing = facts() as Record<string, unknown>;
    delete missing.toolCalls;
    expect(() => assertValidProviderFacts(missing)).toThrow(ProviderFactsValidationError);
  });
});
