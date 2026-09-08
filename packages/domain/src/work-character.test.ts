import { describe, expect, it } from "vitest";
import {
  WORK_CHARACTER_AXES,
  WORK_CHARACTER_SCHEMA_VERSION,
  WorkCharacterValidationError,
  assertValidWorkCharacter,
  calculatePressure,
  type WorkCharacter,
} from "./work-character.js";

const character = (overrides: Partial<WorkCharacter> = {}): WorkCharacter => ({
  schemaVersion: WORK_CHARACTER_SCHEMA_VERSION,
  risk: 90,
  reversibility: 120,
  verificationAttachment: 60,
  materialScale: 80,
  timePressure: 40,
  budgetHeadroom: 100,
  provenance: { taskContractRef: "task-contract:1", headDecisionRef: "head-decision:1" },
  ...overrides,
});

describe("E work character", () => {
  it("accepts the six axes and keeps constraint-only axes separate from pressure", () => {
    const value = character();
    expect(() => assertValidWorkCharacter(value)).not.toThrow();
    const result = calculatePressure(value, 0);
    expect(result.pressureFloor).toBe((90 + (200 - 120) + 60) / 3);
    expect(result.pressure).toBe(result.pressureFloor);
    expect(calculatePressure({ ...value, materialScale: 200, timePressure: 200, budgetHeadroom: 0 }, 0).pressureFloor).toBe(
      result.pressureFloor,
    );
  });

  it("applies Head uplift only as a non-lowering floor", () => {
    const floor = calculatePressure(character(), 0);
    const uplifted = calculatePressure(character(), 180);
    expect(uplifted.pressureFloor).toBe(floor.pressureFloor);
    expect(uplifted.pressure).toBe(180);
    expect(calculatePressure(character(), 20).pressure).toBe(floor.pressureFloor);
  });

  it("is monotonic in the dangerous direction", () => {
    const base = character();
    expect(calculatePressure({ ...base, risk: 91 }, 0).pressureFloor).toBeGreaterThan(calculatePressure(base, 0).pressureFloor);
    expect(calculatePressure({ ...base, reversibility: 119 }, 0).pressureFloor).toBeGreaterThan(calculatePressure(base, 0).pressureFloor);
    expect(calculatePressure({ ...base, verificationAttachment: 61 }, 0).pressureFloor).toBeGreaterThan(
      calculatePressure(base, 0).pressureFloor,
    );
  });

  it("keeps the six-axis contract immutable", () => {
    expect(Object.isFrozen(WORK_CHARACTER_AXES)).toBe(true);
    expect(() => (WORK_CHARACTER_AXES as unknown as string[]).splice(3)).toThrow(TypeError);
    expect(() => assertValidWorkCharacter(character())).not.toThrow();
  });

  it("rejects malformed values, provenance, and routing fields", () => {
    expect(() => assertValidWorkCharacter(character({ risk: 201 }))).toThrow(WorkCharacterValidationError);
    expect(() => assertValidWorkCharacter(character({ risk: 1.5 }))).toThrow(WorkCharacterValidationError);
    expect(() => assertValidWorkCharacter(character({ provenance: { taskContractRef: "", headDecisionRef: "head-decision:1" } }))).toThrow(
      WorkCharacterValidationError,
    );
    expect(() => assertValidWorkCharacter({ ...character(), selectedModel: "openai/model" })).toThrow(WorkCharacterValidationError);
    expect(() => calculatePressure(character(), 201)).toThrow(WorkCharacterValidationError);
    expect(() => calculatePressure(character(), Number.NaN)).toThrow(WorkCharacterValidationError);
  });

  it("rejects enumerable accessor fields", () => {
    const accessor = character() as Record<string, unknown>;
    let reads = 0;
    Object.defineProperty(accessor, "risk", { enumerable: true, get: () => (reads++ === 0 ? 90 : Number.NaN) });
    expect(() => assertValidWorkCharacter(accessor)).toThrow(WorkCharacterValidationError);
    expect(() => calculatePressure(accessor as never, 0)).toThrow(WorkCharacterValidationError);
  });

  it("rejects hidden and inherited fields at the object boundary", () => {
    const hidden = character() as Record<string, unknown>;
    Object.defineProperty(hidden, "provider", { value: "openai", enumerable: false });
    expect(() => assertValidWorkCharacter(hidden)).toThrow(WorkCharacterValidationError);

    const knownHidden = character() as Record<string, unknown>;
    Object.defineProperty(knownHidden, "risk", { value: 90, enumerable: false });
    expect(() => assertValidWorkCharacter(knownHidden)).toThrow(WorkCharacterValidationError);

    const symbol = character() as Record<string | symbol, unknown>;
    symbol[Symbol("provider") as never] = "openai";
    expect(() => assertValidWorkCharacter(symbol)).toThrow(WorkCharacterValidationError);

    const inherited = Object.create({ provider: "openai" });
    Object.assign(inherited, character());
    expect(() => assertValidWorkCharacter(inherited)).toThrow(WorkCharacterValidationError);
  });
});
