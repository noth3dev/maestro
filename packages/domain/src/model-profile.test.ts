import { describe, expect, it } from "vitest";
import {
  MODEL_CAPABILITY_AXES,
  ModelCapabilityValidationError,
  assertValidModelCapabilityVector,
  type ModelCapabilityScore,
  type ModelCapabilityVector,
} from "./model-profile.js";

const evidence = ["benchmark:initial-panel-2026-09-08"] as const;

function scored(score = 70) {
  return { status: "scored" as const, score, rationale: "Panel score reflects the cited evidence.", evidence };
}

function vector(overrides: Partial<Record<(typeof MODEL_CAPABILITY_AXES)[number], ModelCapabilityScore>> = {}): ModelCapabilityVector {
  return {
    schemaVersion: 1,
    axes: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, overrides[axis] ?? scored()])) as ModelCapabilityVector["axes"],
  };
}

describe("model capability vector", () => {
  it("defines the agreed closed eight-axis capability vector", () => {
    expect(MODEL_CAPABILITY_AXES).toEqual([
      "reasoning", "coding", "verification", "instruction-fidelity",
      "tool-use", "long-context", "knowledge", "refusal-calibration",
    ]);
  });

  it("accepts exactly the eight scored capability axes", () => {
    expect(() => assertValidModelCapabilityVector(vector())).not.toThrow();
  });

  it("accepts an explicitly unproven axis without inventing a score", () => {
    const value = vector({
      coding: { status: "unproven", score: null, rationale: "No scored evidence is available yet.", evidence: ["registration:unproven"] },
    });
    expect(() => assertValidModelCapabilityVector(value)).not.toThrow();
  });

  it("rejects a missing capability axis", () => {
    const value = vector();
    delete (value.axes as Record<string, unknown>).knowledge;
    expect(() => assertValidModelCapabilityVector(value)).toThrow(ModelCapabilityValidationError);
  });

  it("does not accept required axes or fields inherited from a prototype", () => {
    const value = vector();
    delete (value.axes as Record<string, unknown>).knowledge;
    Object.setPrototypeOf(value.axes, { knowledge: scored() });
    expect(() => assertValidModelCapabilityVector(value)).toThrow(ModelCapabilityValidationError);

    const inherited = Object.create({ schemaVersion: 1, axes: value.axes }) as Record<string, unknown>;
    expect(() => assertValidModelCapabilityVector(inherited)).toThrow(ModelCapabilityValidationError);
  });

  it("rejects capability axes outside the closed first-version set", () => {
    const value = vector();
    (value.axes as Record<string, unknown>).creativity = scored();
    expect(() => assertValidModelCapabilityVector(value)).toThrow(ModelCapabilityValidationError);
  });

  it("requires scored values to be integers from 0 through 100", () => {
    expect(() => assertValidModelCapabilityVector(vector({ reasoning: scored(101) }))).toThrow(ModelCapabilityValidationError);
    expect(() => assertValidModelCapabilityVector(vector({ reasoning: scored(12.5) }))).toThrow(ModelCapabilityValidationError);
    expect(() => assertValidModelCapabilityVector(vector({ reasoning: scored(-1) }))).toThrow(ModelCapabilityValidationError);
  });

  it("requires one-line rationale and evidence for every axis", () => {
    expect(() => assertValidModelCapabilityVector(vector({ coding: { ...scored(), rationale: "two\nlines" } }))).toThrow(ModelCapabilityValidationError);
    expect(() => assertValidModelCapabilityVector(vector({ coding: { ...scored(), rationale: "" } }))).toThrow(ModelCapabilityValidationError);
    expect(() => assertValidModelCapabilityVector(vector({ coding: { ...scored(), evidence: [] } }))).toThrow(ModelCapabilityValidationError);
  });

  it("rejects malformed outer shapes, versions, and statuses", () => {
    expect(() => assertValidModelCapabilityVector({ ...vector(), schemaVersion: 2 })).toThrow(ModelCapabilityValidationError);
    expect(() => assertValidModelCapabilityVector({ ...vector(), extra: true })).toThrow(ModelCapabilityValidationError);
    expect(() => assertValidModelCapabilityVector({ ...vector(), axes: [] })).toThrow(ModelCapabilityValidationError);
    expect(() => assertValidModelCapabilityVector(vector({ reasoning: { ...scored(), status: "unknown" as never } }))).toThrow(ModelCapabilityValidationError);
  });

  it("rejects malformed evidence references, including sparse entries", () => {
    expect(() => assertValidModelCapabilityVector(vector({ coding: { ...scored(), evidence: ["", "source"] } }))).toThrow(ModelCapabilityValidationError);
    expect(() => assertValidModelCapabilityVector(vector({ coding: { ...scored(), evidence: ["two\nlines"] } }))).toThrow(ModelCapabilityValidationError);
    const sparse = [...evidence];
    delete (sparse as string[])[0];
    expect(() => assertValidModelCapabilityVector(vector({ coding: { ...scored(), evidence: sparse } }))).toThrow(ModelCapabilityValidationError);
  });

  it("rejects a scored axis with a null score or an unproven axis with a score", () => {
    expect(() => assertValidModelCapabilityVector(vector({ reasoning: { ...scored(), score: null } }))).toThrow(ModelCapabilityValidationError);
    expect(() => assertValidModelCapabilityVector(vector({ reasoning: { ...scored(), status: "unproven" } }))).toThrow(ModelCapabilityValidationError);
  });
});
