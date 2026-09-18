import { describe, expect, it } from "vitest";
import { MODEL_CAPABILITY_AXES } from "./model-profile.js";
import { TASK_DEMAND_SCHEMA_VERSION, type TaskCapabilityRequirement, type TaskDemand } from "./task-demand.js";
import { WORK_CHARACTER_SCHEMA_VERSION, type WorkCharacter } from "./work-character.js";
import {
  ROUTING_WORK_INPUT_SCHEMA_VERSION,
  RoutingWorkInputValidationError,
  assertValidRoutingWorkInput,
  type RoutingWorkInput,
} from "./routing-work-input.js";

const requirement = (level = 80): TaskCapabilityRequirement => ({
  level,
  rationale: "The Head set this level from the Task Contract.",
});

function demand(): TaskDemand {
  return {
    schemaVersion: TASK_DEMAND_SCHEMA_VERSION,
    taskKinds: ["coding"],
    requirements: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, requirement()])) as TaskDemand["requirements"],
    provenance: { taskContractRef: "task-contract:1", headDecisionRef: "head-decision:1" },
  };
}

function character(): WorkCharacter {
  return {
    schemaVersion: WORK_CHARACTER_SCHEMA_VERSION,
    risk: 90,
    reversibility: 120,
    verificationAttachment: 60,
    materialScale: 80,
    timePressure: 40,
    budgetHeadroom: 100,
    provenance: { taskContractRef: "task-contract:1", headDecisionRef: "head-decision:1" },
  };
}

function input(overrides: Partial<RoutingWorkInput> = {}): RoutingWorkInput {
  return { schemaVersion: ROUTING_WORK_INPUT_SCHEMA_VERSION, workCharacter: character(), explicitHeadUplift: 0, ...overrides };
}

describe("routing work input", () => {
  it("accepts a sealed demand-bound work character", () => {
    expect(() => assertValidRoutingWorkInput(input(), demand())).not.toThrow();
  });

  it("rejects unknown fields and bad versions", () => {
    expect(() => assertValidRoutingWorkInput({ ...input(), extra: true }, demand())).toThrow(RoutingWorkInputValidationError);
    expect(() => assertValidRoutingWorkInput(input({ schemaVersion: 999 as never }), demand())).toThrow(RoutingWorkInputValidationError);
    expect(() => assertValidRoutingWorkInput(input(), demand())).not.toThrow();
  });

  it("requires provenance agreement between work character and demand", () => {
    const mismatched = input({
      workCharacter: { ...character(), provenance: { taskContractRef: "task-contract:2", headDecisionRef: "head-decision:1" } },
    });
    expect(() => assertValidRoutingWorkInput(mismatched, demand())).toThrow(/taskContractRef must match/);
    const badDemand = demand();
    badDemand.provenance = { taskContractRef: " ", headDecisionRef: "head-decision:1" };
    expect(() => assertValidRoutingWorkInput(input(), badDemand)).toThrow(RoutingWorkInputValidationError);
  });

  it("rejects an invalid uplift", () => {
    expect(() => assertValidRoutingWorkInput(input({ explicitHeadUplift: 201 }), demand())).toThrow(RoutingWorkInputValidationError);
  });
});
