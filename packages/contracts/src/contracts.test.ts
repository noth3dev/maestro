import { describe, expect, it } from "vitest";
import {
  CreateGoalInputSchema,
  CriticalActionInputSchema,
  ProjectAccessProvisionInputSchema,
  GoalStateSchema,
  StableApiErrorSchema,
  TransitionGoalInputSchema,
  MissionBundleSubstanceSchema,
  TaskDemandSchema,
  ProviderFactsSchema,
  OperationalOverlaySchema,
  OperationalOverlaySnapshotSchema,
  PressureBandProjectionSchema,
  RoutingEvidenceSchema,
} from "./index.js";

const projectId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f01";
const capabilityAxes = ["reasoning", "coding", "verification", "instruction-fidelity", "tool-use", "long-context", "knowledge", "refusal-calibration"] as const;


describe("goal HTTP contracts", () => {
  it("accepts public create and transition inputs", () => {
    expect(CreateGoalInputSchema.parse({ projectId })).toEqual({ projectId });
    expect(TransitionGoalInputSchema.parse({ projectId, expectedVersion: 1, to: "ready_for_confirmation" })).toEqual({
      projectId,
      expectedVersion: 1,
      to: "ready_for_confirmation",
    });
  });

  it("does not expose actor, approval, or fencing fields", () => {
    expect(CreateGoalInputSchema.safeParse({ projectId, actorId: "operator" }).success).toBe(false);
    expect(TransitionGoalInputSchema.safeParse({ projectId, expectedVersion: 1, to: "active", fencingToken: "1" }).success).toBe(false);
  });

  it("rejects negative, unsafe, or oversized effect budgets", () => {
    const base = { projectId, action: "payment.spend", target: "merchant", policyVersion: 1 };
    expect(CriticalActionInputSchema.safeParse({ ...base, budgetEffectCents: -1 }).success).toBe(false);
    expect(CriticalActionInputSchema.safeParse({ ...base, budgetEffectCents: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
    expect(CriticalActionInputSchema.safeParse({ ...base, budgetEffectCents: 1_000_000_001 }).success).toBe(false);
    expect(CriticalActionInputSchema.safeParse({ ...base, budgetEffectCents: 1_000_000_000 }).success).toBe(true);
  });

  it("provides closed goal states and stable errors", () => {
    expect(GoalStateSchema.safeParse("unknown").success).toBe(false);
    expect(StableApiErrorSchema.parse({ error: { code: "version_conflict", message: "Version conflict" } })).toEqual({
      error: { code: "version_conflict", message: "Version conflict" },
    });
  });
});

describe("project access provisioning contracts", () => {
  it("requires a canonical operator/project pair and exact non-empty roles", () => {
    const input = { operatorId: projectId, projectId, roles: ["concertmaster", "head-product"] };
    expect(ProjectAccessProvisionInputSchema.parse(input)).toEqual(input);
    expect(ProjectAccessProvisionInputSchema.safeParse({ ...input, roles: [] }).success).toBe(false);
    expect(ProjectAccessProvisionInputSchema.safeParse({ ...input, roles: ["concertmaster", "concertmaster"] }).success).toBe(false);
  });

  it("rejects attempts to smuggle actor or capability fields into provisioning", () => {
    expect(
      ProjectAccessProvisionInputSchema.safeParse({ operatorId: projectId, projectId, roles: ["concertmaster"], actorId: projectId })
        .success,
    ).toBe(false);
    expect(ProjectAccessProvisionInputSchema.safeParse({ operatorId: projectId, projectId, roles: ["*"] }).success).toBe(false);
  });
});

describe("conversation streaming contracts", () => {
  it("accepts the stable unknown account-login error code", async () => {
    const { StableApiErrorSchema } = await import("./index.js");
    expect(
      StableApiErrorSchema.parse({ error: { code: "account_login_session_unknown", message: "Account login session is unknown" } }).error
        .code,
    ).toBe("account_login_session_unknown");
  });

  it("accepts durable turn delta events", async () => {
    const { ConversationEventSchema } = await import("./index.js");
    expect(
      ConversationEventSchema.parse({
        cursor: "3",
        eventId: projectId,
        conversationId: projectId,
        projectId,
        eventType: "turn_delta",
        payload: { turnId: projectId, text: "chunk" },
        occurredAt: "2030-01-01T00:00:00.000Z",
      }).eventType,
    ).toBe("turn_delta");
  });
});

describe("TaskDemand and Mission Bundle routing contracts", () => {
  const requirement = { level: 80, rationale: "The Head set this level from the Task Contract." };
  const taskDemand = {
    schemaVersion: 1,
    taskKinds: ["coding"],
    requirements: {
      reasoning: requirement,
      coding: requirement,
      verification: requirement,
      "instruction-fidelity": requirement,
      "tool-use": requirement,
      "long-context": requirement,
      knowledge: requirement,
      "refusal-calibration": requirement,
    },
    provenance: { taskContractRef: "task-contract:1", headDecisionRef: "head-decision:1" },
  };

  it("requires the complete eight-axis demand on a Mission Bundle", () => {
    const substance = {
      role: "execution",
      profileRef: "profile-1",
      goalBrief: "implement safely",
      taskDemand,
      approvedModels: ["test/model-a"],
      allowedSkills: ["implementation"],
      allowedTools: ["write"],
      allowedPaths: ["packages/product"],
      environment: ["node24"],
      authorityBoundary: ["bounded"],
      externalServiceBoundary: ["none"],
      dataBoundary: ["repository"],
      costCeiling: "1 USD",
      timeCeiling: "1 hour",
      retryCeiling: 1,
      workerCeiling: 0,
      deliverable: "a patch",
      evidenceRequirements: ["tests"],
      validationCriteria: ["tests pass"],
      terminationConditions: ["complete"],
    };
    const parsedDemand = TaskDemandSchema.parse(taskDemand);
    const readonlyKinds: readonly string[] = parsedDemand.taskKinds;
    expect(readonlyKinds).toEqual(["coding"]);
    expect(parsedDemand).toEqual(taskDemand);
    expect(Object.isFrozen(parsedDemand.taskKinds)).toBe(false);
    expect(() => parsedDemand.taskKinds.push("verification")).not.toThrow();
    expect(MissionBundleSubstanceSchema.parse(substance)).toEqual(substance);
    expect(MissionBundleSubstanceSchema.safeParse({ ...substance, taskDemand: { ...taskDemand, provider: "openai" } }).success).toBe(false);
    expect(TaskDemandSchema.safeParse({ ...taskDemand, taskKinds: ["coding", "coding"] }).success).toBe(false);
    expect(TaskDemandSchema.safeParse({ ...taskDemand, requirements: { ...taskDemand.requirements, knowledge: undefined } }).success).toBe(
      false,
    );
    expect(
      TaskDemandSchema.safeParse({ ...taskDemand, provenance: { taskContractRef: " ", headDecisionRef: "head-decision:1" } }).success,
    ).toBe(false);
    expect(
      TaskDemandSchema.safeParse({
        ...taskDemand,
        requirements: { ...taskDemand.requirements, coding: { ...requirement, rationale: "line\nnext" } },
      }).success,
    ).toBe(false);
  });
});

describe("Ensemble Router artifact wire contracts", () => {
  const facts = {
    schemaVersion: 1 as const,
    contextCapacity: 128_000,
    pricing: { inputPerMillionTokens: 2, outputPerMillionTokens: 8 },
    authentication: { modes: ["api-key"] },
    dataPolicy: { allowedDataClasses: ["public"], retention: "transient" as const, trainingUse: "never" as const, regions: ["us"] },
    modalities: ["text"],
    toolCalls: { supported: true },
    provenance: { source: "provider-docs:model", observedAt: "2026-09-08" },
  };
  const observation = {
    candidateRef: "candidate-1",
    measuredLatencyMs: 10,
    measuredCost: 0.01,
    failureRate: 0,
    timeoutRate: 0,
    providerErrorRate: 0,
    currentAvailability: true,
    accountBinding: "account-1",
    observedAt: "2026-09-08T12:00:00Z",
  };

  it("accepts B facts, C overlay/snapshot, and pressure projection wire shapes", () => {
    expect(ProviderFactsSchema.parse(facts)).toEqual(facts);
    const overlay = {
      schemaVersion: 1 as const,
      installationRef: "installation-1",
      projectRef: "project-1",
      version: 1,
      observations: [observation],
    };
    expect(OperationalOverlaySchema.parse(overlay)).toEqual(overlay);
    const snapshot = {
      schemaVersion: 1 as const,
      installationRef: "installation-1",
      projectRef: "project-1",
      goalRef: "goal-1",
      overlayVersion: 1,
      observations: [observation],
    };
    expect(OperationalOverlaySnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(PressureBandProjectionSchema.parse({ pressure: 150, band: "critical", decisionLayer: "user" })).toEqual({
      pressure: 150,
      band: "critical",
      decisionLayer: "user",
    });
    const evidence = {
      schemaVersion: 1 as const,
      evidenceId: "evidence-1",
      goalRef: "goal-1",
      projectRef: "project-1",
      routeRef: "route-1",
      mode: "ensemble" as const,
      selectedModelRef: "provider/model",
      accountBinding: "account-1",
      candidateRefs: ["candidate-1"],
      rejections: [],
      taskDemandHash: "a".repeat(64),
      pressure: 100,
      pressureBand: "high" as const,
      decisionLayer: "Encore Council" as const,
      overlayVersion: 1,
      admissionBindingRef: "binding-1",
      rationale: "selected",
      createdAt: "2026-09-08T12:00:00Z",
      pressureCalculation: { pressureFloor: 200 / 3, pressure: 100, explicitHeadUplift: 100 },
            approvalIdentity: null,
      taskKindRecipeVersions: { coding: 1 },
      taskDemand: { schemaVersion: 1, taskKinds: ["coding"], requirements: Object.fromEntries(capabilityAxes.map((axis) => [axis, { level: 80, rationale: "Head requirement" }])), provenance: { taskContractRef: "contract-1", headDecisionRef: "decision-1" } },
      workCharacter: { schemaVersion: 1, risk: 40, reversibility: 120, verificationAttachment: 80, materialScale: 20, timePressure: 30, budgetHeadroom: 150, provenance: { taskContractRef: "contract-1", headDecisionRef: "decision-1" } },
      modelProfile: { modelRef: "provider/model", capability: { schemaVersion: 2, axes: Object.fromEntries(capabilityAxes.map((axis) => [axis, { status: "scored", score: 180, rationale: "review", evidence: ["review-1"] }])) }, providerFacts: facts, provenance: { owner: "human", sourceRefs: ["review-1"], reviewedAt: "2026-09-08" } },
      operationalOverlaySnapshot: snapshot,
      approvalRef: null,
    };
    expect(RoutingEvidenceSchema.parse(evidence)).toEqual(evidence);
    expect(RoutingEvidenceSchema.safeParse({ ...evidence, modelProfile: { ...evidence.modelProfile, capability: {}, providerFacts: {}, provenance: {} } }).success).toBe(false);
    expect(RoutingEvidenceSchema.safeParse({ ...evidence, operationalOverlaySnapshot: {} }).success).toBe(false);
  });

  it("fails closed on missing facts, forbidden identity fields, and unavailable bindings", () => {
    expect(ProviderFactsSchema.safeParse({ ...facts, contextCapacity: undefined }).success).toBe(false);
    expect(ProviderFactsSchema.safeParse({ ...facts, reasoning: 200 }).success).toBe(false);
    expect(
      OperationalOverlaySchema.safeParse({
        schemaVersion: 1,
        installationRef: "i",
        projectRef: "p",
        version: 1,
        observations: [{ ...observation, currentAvailability: true, accountBinding: null }],
      }).success,
    ).toBe(false);
    expect(
      OperationalOverlaySchema.safeParse({
        schemaVersion: 1,
        installationRef: "i",
        projectRef: "p",
        version: 1,
        observations: [{ ...observation, model: "provider/model" }],
      }).success,
    ).toBe(false);
    expect(PressureBandProjectionSchema.safeParse({ pressure: 201, band: "critical", decisionLayer: "user" }).success).toBe(false);
    expect(
      RoutingEvidenceSchema.safeParse({
        schemaVersion: 1,
        evidenceId: "e",
        goalRef: "g",
        projectRef: "p",
        routeRef: "r",
        mode: "ensemble",
        selectedModelRef: "model",
        accountBinding: "a",
        candidateRefs: ["c"],
        taskDemandHash: "bad",
        pressure: 100,
        pressureBand: "high",
        decisionLayer: "Encore Council",
        overlayVersion: 1,
        admissionBindingRef: "b",
        rationale: "r",
        createdAt: "now",
      }).success,
    ).toBe(false);
  });
});
