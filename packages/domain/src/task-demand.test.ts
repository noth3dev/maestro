import { describe, expect, it } from "vitest";
import {
  TASK_DEMAND_SCHEMA_VERSION,
  TASK_KIND_RECIPE_SCHEMA_VERSION,
  TASK_KIND_RECIPES,
  TASK_KINDS,
  TaskDemandValidationError,
  assertValidTaskDemand,
  assertValidTaskKindRecipe,
  composeTaskKindEmphasis,
  declareTaskDemand,
  getTaskKindRecipe,
  type TaskCapabilityRequirement,
  type TaskDemand,
} from "./task-demand.js";
import { MODEL_CAPABILITY_AXES, MODEL_CAPABILITY_SCORE_MAX } from "./model-profile.js";

const requirement = (level = 80): TaskCapabilityRequirement => ({
  level,
  rationale: level === 0 ? "This task does not require this capability." : "The Head set this level from the Task Contract.",
});

function demand(overrides: Partial<TaskDemand> = {}): TaskDemand {
  return {
    schemaVersion: TASK_DEMAND_SCHEMA_VERSION,
    taskKinds: ["coding"],
    requirements: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, requirement()])) as TaskDemand["requirements"],
    provenance: { taskContractRef: "task-contract:1", headDecisionRef: "head-decision:1" },
    ...overrides,
  };
}

describe("task-kind recipes", () => {
  it("defines recipes as axis roles, not fixed capability levels", () => {
    expect(TASK_KINDS).toEqual(["planning", "coding", "verification", "research", "debugging", "tool-operation"]);
    expect(TASK_KIND_RECIPE_SCHEMA_VERSION).toBe(1);
    expect(TASK_DEMAND_SCHEMA_VERSION).toBe(1);
    expect(TASK_KIND_RECIPES).toHaveLength(TASK_KINDS.length);
    for (const recipe of TASK_KIND_RECIPES) {
      expect(() => assertValidTaskKindRecipe(recipe)).not.toThrow();
      expect(Object.keys(recipe.axisRoles).sort()).toEqual([...MODEL_CAPABILITY_AXES].sort());
      expect(JSON.stringify(recipe)).not.toContain("level");
    }
  });

  it("rejects hidden unknown fields in a recipe or its axis roles", () => {
    const base = getTaskKindRecipe("coding");
    const recipe = { ...base, axisRoles: { ...base.axisRoles } };
    Object.setPrototypeOf(recipe.axisRoles, { provider: "openai" });
    expect(() => assertValidTaskKindRecipe(recipe)).toThrow(TaskDemandValidationError);

    const hidden = { ...getTaskKindRecipe("coding"), provider: "openai" } as Record<string, unknown>;
    Object.defineProperty(hidden, "provider", { value: "openai", enumerable: false });
    expect(() => assertValidTaskKindRecipe(hidden)).toThrow(TaskDemandValidationError);
  });

  it("combines multiple kinds by the strongest axis role without producing demand levels", () => {
    const combined = composeTaskKindEmphasis(["planning", "coding"]);
    expect(combined.reasoning).toBe("primary");
    expect(combined.coding).toBe("primary");
    expect(combined["instruction-fidelity"]).toBe("primary");
    expect(combined.knowledge).toBe("supporting");
  });

  it("returns known recipes and rejects unknown or duplicate kinds", () => {
    expect(getTaskKindRecipe("coding").kind).toBe("coding");
    expect(() => getTaskKindRecipe("unknown" as never)).toThrow(TaskDemandValidationError);
    expect(() => composeTaskKindEmphasis([])).toThrow(TaskDemandValidationError);
    expect(() => composeTaskKindEmphasis(["coding", "coding"])).toThrow(TaskDemandValidationError);
  });
});

describe("runtime task demand", () => {
  it("seals explicit Head levels without deriving them from the static recipe", () => {
    const low = declareTaskDemand({
      taskKinds: ["coding"],
      requirements: { ...demand().requirements, coding: requirement(40) },
      taskContractRef: "task-contract:low-risk-formatting",
      headDecisionRef: "head-decision:low-risk-formatting",
    });
    const high = declareTaskDemand({
      taskKinds: ["coding"],
      requirements: { ...demand().requirements, coding: requirement(180) },
      taskContractRef: "task-contract:authority-migration",
      headDecisionRef: "head-decision:authority-migration",
    });
    expect(low.requirements.coding.level).toBe(40);
    expect(high.requirements.coding.level).toBe(180);
    expect(low.taskKinds).toEqual(high.taskKinds);
  });

  it("rejects extra routing or incomplete declaration fields before sealing", () => {
    const valid = {
      taskKinds: ["coding"],
      requirements: demand().requirements,
      taskContractRef: "task-contract:1",
      headDecisionRef: "head-decision:1",
    };
    expect(() => declareTaskDemand({ ...valid, selectedModel: "openai/model" })).toThrow(TaskDemandValidationError);
    expect(() => declareTaskDemand({ ...valid, headDecisionRef: "" })).toThrow(TaskDemandValidationError);
    expect(() => declareTaskDemand({ ...valid, requirements: { ...valid.requirements, coding: undefined } })).toThrow(TaskDemandValidationError);
  });

  it("accepts a Head-declared 0..200 requirement vector with provenance", () => {
    expect(() => assertValidTaskDemand(demand({ requirements: {
      ...demand().requirements,
      coding: requirement(MODEL_CAPABILITY_SCORE_MAX),
    } }))).not.toThrow();
  });

  it("rejects a demand that carries provider or model selection fields", () => {
    const value = { ...demand(), selectedModel: "openai/model" };
    expect(() => assertValidTaskDemand(value)).toThrow(TaskDemandValidationError);
  });

  it("rejects malformed requirements and missing provenance", () => {
    expect(() => assertValidTaskDemand(demand({ requirements: {
      ...demand().requirements,
      reasoning: { ...requirement(), level: MODEL_CAPABILITY_SCORE_MAX + 1 },
    } }))).toThrow(TaskDemandValidationError);
    expect(() => assertValidTaskDemand(demand({ provenance: { taskContractRef: "", headDecisionRef: "head-decision:1" } }))).toThrow(TaskDemandValidationError);
    const missing = demand({ requirements: { ...demand().requirements } });
    delete (missing.requirements as Record<string, unknown>).knowledge;
    expect(() => assertValidTaskDemand(missing)).toThrow(TaskDemandValidationError);
  });

  it("does not accept inherited task kinds, requirements, or provenance fields", () => {
    const value = demand();
    delete (value.requirements as Record<string, unknown>).knowledge;
    Object.setPrototypeOf(value.requirements, { knowledge: requirement() });
    expect(() => assertValidTaskDemand(value)).toThrow(TaskDemandValidationError);

    const inherited = Object.create({ schemaVersion: TASK_DEMAND_SCHEMA_VERSION, taskKinds: ["coding"], requirements: demand().requirements, provenance: demand().provenance }) as Record<string, unknown>;
    expect(() => assertValidTaskDemand(inherited)).toThrow(TaskDemandValidationError);
  });

  it("rejects hidden fields attached to the taskKinds array", () => {
    const nonEnumerableKinds = ["coding"] as unknown as string[];
    Object.defineProperty(nonEnumerableKinds, "provider", { value: "openai", enumerable: false });
    expect(() => assertValidTaskDemand(demand({ taskKinds: nonEnumerableKinds as never }))).toThrow(TaskDemandValidationError);
    expect(() => declareTaskDemand({
      taskKinds: nonEnumerableKinds,
      requirements: demand().requirements,
      taskContractRef: "task-contract:1",
      headDecisionRef: "head-decision:1",
    })).toThrow(TaskDemandValidationError);

    const symbolKinds = ["coding"] as unknown as string[];
    symbolKinds[Symbol("provider") as never] = "openai";
    expect(() => assertValidTaskDemand(demand({ taskKinds: symbolKinds as never }))).toThrow(TaskDemandValidationError);

    const inheritedKinds = ["coding"] as unknown as string[];
    Object.setPrototypeOf(inheritedKinds, { provider: "openai" });
    expect(() => assertValidTaskDemand(demand({ taskKinds: inheritedKinds as never }))).toThrow(TaskDemandValidationError);
  });

  it("rejects known fields when hidden as non-enumerable properties", () => {
    const outer = demand() as Record<string, unknown>;
    Object.defineProperty(outer, "provenance", { value: demand().provenance, enumerable: false });
    expect(() => assertValidTaskDemand(outer)).toThrow(TaskDemandValidationError);

    const nested = demand();
    Object.defineProperty(nested.requirements, "coding", { value: nested.requirements.coding, enumerable: false });
    expect(() => assertValidTaskDemand(nested)).toThrow(TaskDemandValidationError);
  });

  it("rejects unknown fields hidden in prototypes, non-enumerable properties, or symbols", () => {
    const outer = demand();
    Object.setPrototypeOf(outer, { provider: "openai" });
    expect(() => assertValidTaskDemand(outer)).toThrow(TaskDemandValidationError);

    const nested = demand();
    Object.setPrototypeOf(nested.provenance, { provider: "openai" });
    expect(() => assertValidTaskDemand(nested)).toThrow(TaskDemandValidationError);

    const hidden = demand() as Record<string, unknown>;
    Object.defineProperty(hidden, "provider", { value: "openai", enumerable: false });
    expect(() => assertValidTaskDemand(hidden)).toThrow(TaskDemandValidationError);

    const symbol = demand() as Record<string | symbol, unknown>;
    symbol[Symbol("provider")] = "openai";
    expect(() => assertValidTaskDemand(symbol)).toThrow(TaskDemandValidationError);
  });

  it("rejects empty, duplicate, or unknown task kinds", () => {
    expect(() => assertValidTaskDemand(demand({ taskKinds: [] }))).toThrow(TaskDemandValidationError);
    expect(() => assertValidTaskDemand(demand({ taskKinds: ["coding", "coding"] }))).toThrow(TaskDemandValidationError);
    expect(() => assertValidTaskDemand(demand({ taskKinds: ["unknown" as never] }))).toThrow(TaskDemandValidationError);
  });
});
