import { describe, expect, it } from "vitest";
import { MODEL_CAPABILITY_SCHEMA_VERSION } from "./model-profile.js";
import { MODEL_MAP_SCHEMA_VERSION, ModelMapValidationError, assertValidModelMap, type ModelMap } from "./model-map.js";
import { PROVIDER_FACTS_SCHEMA_VERSION } from "./provider-facts.js";

function modelMap(overrides: Partial<ModelMap> = {}): ModelMap {
  const axes = Object.fromEntries(
    ["reasoning", "coding", "verification", "instruction-fidelity", "tool-use", "long-context", "knowledge", "refusal-calibration"].map(
      (axis) => [axis, { status: "unproven", score: null, rationale: "not scored", evidence: ["pending"] }],
    ),
  ) as ModelMap["entries"][number]["capability"]["axes"];
  return {
    schemaVersion: MODEL_MAP_SCHEMA_VERSION,
    entries: [
      {
        modelRef: "provider/model-1",
        capability: { schemaVersion: MODEL_CAPABILITY_SCHEMA_VERSION, axes },
        providerFacts: {
          schemaVersion: PROVIDER_FACTS_SCHEMA_VERSION,
          contextCapacity: 128_000,
          pricing: { inputPerMillionTokens: 1, outputPerMillionTokens: 2 },
          authentication: { modes: ["api-key"] },
          dataPolicy: { allowedDataClasses: ["public"], retention: "none", trainingUse: "never", regions: ["us"] },
          modalities: ["text"],
          toolCalls: { supported: true },
          provenance: { source: "provider-docs", observedAt: "2026-09-08" },
        },
        provenance: { owner: "human", sourceRefs: ["human-review:pending"], reviewedAt: "2026-09-08" },
      },
    ],
    ...overrides,
  };
}

describe("human-owned model_map", () => {
  it("accepts exact provider/model entries with A/B provenance", () => expect(() => assertValidModelMap(modelMap())).not.toThrow());
  it("allows an empty baseline but rejects duplicate or malformed identities", () => {
    expect(() => assertValidModelMap({ schemaVersion: 1, entries: [] })).not.toThrow();
    expect(() => assertValidModelMap(modelMap({ entries: [modelMap().entries[0]!, { ...modelMap().entries[0]! }] }))).toThrow(
      ModelMapValidationError,
    );
    expect(() => assertValidModelMap(modelMap({ entries: [{ ...modelMap().entries[0]!, modelRef: "provider/model/extra" }] }))).toThrow(
      ModelMapValidationError,
    );
  });
  it("rejects machine-owned provenance, routing overlays, and hostile hidden fields", () => {
    expect(() =>
      assertValidModelMap(
        modelMap({
          entries: [{ ...modelMap().entries[0]!, provenance: { ...modelMap().entries[0]!.provenance, owner: "router" as never } }],
        }),
      ),
    ).toThrow(ModelMapValidationError);
    expect(() => assertValidModelMap({ ...modelMap(), overlay: {} })).toThrow(ModelMapValidationError);
    const hostile = modelMap() as Record<string, unknown>;
    Object.defineProperty(hostile, "overlay", { value: {}, enumerable: false });
    expect(() => assertValidModelMap(hostile)).toThrow(ModelMapValidationError);
  });
});
