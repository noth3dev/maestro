import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  assertValidImprovementCandidateInput,
  improvementCandidateScenarioSuiteHash,
  materializeImprovementCandidate,
  type ImprovementCandidateInput,
} from "@maestro/domain";
import { buildPersonaCandidateInput } from "./Persona.js";
import { PersonaPanel } from "./panels/persona/PersonaPanel.js";
import type { PersonaInspection } from "@maestro/contracts";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const editedProjectId = "33333333-3333-4333-8333-333333333333";
const editedGoalId = "44444444-4444-4444-8444-444444444444";
const candidateId = "55555555-5555-4555-8555-555555555555";
const sourceEvidenceId = "66666666-6666-4666-8666-666666666666";

function candidateInput(): ImprovementCandidateInput {
  const scenarioSuite = ["persona-baseline"];
  return {
    schemaVersion: 1,
    projectId,
    goalId,
    kind: "persona_axis",
    target: { roleId: "concertmaster", taskClass: "implementation" },
    changes: [{ axis: "caution", currentValue: 0.4, proposedValue: 0.5 }],
    sourceEvidenceIds: [sourceEvidenceId],
    evidencePattern: "Repeated evidence supports a small caution adjustment.",
    predictedEffect: "The persona will pause more often before uncertain actions.",
    expectedMetrics: [{ name: "safe_pause_rate", unit: "ratio", direction: "increase", target: 0.6 }],
    protectedMetrics: [{ name: "truthfulness", unit: "ratio", minimum: 0.8 }],
    scenarioSuite,
    scenarioSuiteHash: improvementCandidateScenarioSuiteHash(scenarioSuite),
    confidence: 0.8,
    dataSufficiency: { episodeCount: 4, comparableGoalCount: 2 },
    rollbackTarget: { candidateId, version: 1, contentHash: "a".repeat(64) },
  };
}

describe("Persona candidate editing", () => {
  it("sends only ImprovementCandidateInput fields when editing a persisted candidate", () => {
    const input = candidateInput();
    const persisted = materializeImprovementCandidate(input, {
      candidateId,
      version: 1,
      parentCandidateId: null,
      authorId: "operator",
      sessionRef: "session:persona",
      createdAt: "2026-09-16T00:00:00.000Z",
    });
    const changes = persisted.changes.map((change) => ({ ...change }));

    const edited = buildPersonaCandidateInput(persisted, editedProjectId, editedGoalId, changes);

    expect(() => assertValidImprovementCandidateInput(edited)).not.toThrow();
    expect(edited).toEqual({ ...input, projectId: editedProjectId, goalId: editedGoalId, changes });
    expect(edited).not.toHaveProperty("candidateId");
    expect(edited).not.toHaveProperty("contentHash");
    expect(edited).not.toHaveProperty("state");
  });
});


describe("Persona server state labels", () => {
  it("keeps the active profile and candidate proposal visibly distinct", () => {
    const persisted = materializeImprovementCandidate(candidateInput(), {
      candidateId, version: 2, parentCandidateId: null, authorId: "operator", sessionRef: "session:persona", createdAt: "2026-09-16T00:00:00.000Z",
    });
    const model = {
      roleId: "concertmaster", taskClass: "implementation", version: 7,
      profile: { agreeableness: 0.4, extraversion: 0.4, imagination: 0.4, realism: 0.4, conscientiousness: 0.4, caution: 0.4, initiative: 0.4, empathy: 0.4, adaptability: 0.4, sociability: 0.4 },
      coreIdentity: { mission: "deliver truthful work", authority: ["coordinate"], truthfulness: "report evidence", safety: "escalate risk", prohibitedBehavior: ["invent evidence"] },
      taskClassAdjustment: { roleId: "concertmaster", taskClass: "implementation", version: 2, delta: {}, reason: "implementation" },
      missionOverlay: {}, proposalTemplate: candidateInput(),
      candidates: [{ candidate: persisted, candidateId, version: 2, state: "candidate", changedAxes: ["caution"], decision: "pending", invalidated: false }], rollouts: [],
    } satisfies PersonaInspection;
    const html = renderToStaticMarkup(<PersonaPanel model={model} expanded />);
    expect(html).toContain("active persona");
    expect(html).toContain("learned profile version 7");
    expect(html).toContain("candidate proposal");
    expect(html).toContain("rationale: Repeated evidence supports a small caution adjustment.");
    expect(html).not.toContain("active persona: version 2");
  });
});
