import { describe, expect, it, vi } from "vitest";
import type { PersonaInspection, PersonaProposalInput } from "@maestro/contracts";
import { ApiError } from "@maestro/api-client";
import { editPersonaCandidate, getPersona, isActivePersonaCandidate, proposePersona, type PersonaApi } from "./persona-data.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const candidateId = "33333333-3333-4333-8333-333333333333";
const query = { projectId, goalId, roleId: "concertmaster", taskClass: "implementation" };
const candidate = {
  schemaVersion: 1 as const,
  projectId,
  goalId,
  kind: "persona_axis" as const,
  target: { roleId: "concertmaster", taskClass: "implementation" },
  changes: [{ axis: "caution" as const, currentValue: 0.4, proposedValue: 0.5 }],
  sourceEvidenceIds: ["44444444-4444-4444-8444-444444444444"],
  evidencePattern: "Repeated safe pauses are durable evidence.",
  predictedEffect: "Pause before uncertain actions.",
  expectedMetrics: [{ name: "safe_pause_rate", unit: "ratio", direction: "increase" as const, target: 0.6 }],
  protectedMetrics: [{ name: "truthfulness", unit: "ratio", minimum: 0.8 }],
  scenarioSuite: ["persona-baseline"],
  scenarioSuiteHash: "a".repeat(64),
  confidence: 0.8,
  dataSufficiency: { episodeCount: 4, comparableGoalCount: 2 },
  rollbackTarget: { candidateId, version: 1, contentHash: "b".repeat(64) },
};
const input = { projectId, goalId, candidate } satisfies PersonaProposalInput;
const inspection = {
  roleId: "concertmaster",
  taskClass: "implementation",
  profile: { agreeableness: 0.4, extraversion: 0.4, imagination: 0.4, realism: 0.4, conscientiousness: 0.4, caution: 0.4, initiative: 0.4, empathy: 0.4, adaptability: 0.4, sociability: 0.4 },
  version: 7,
  coreIdentity: { mission: "deliver truthful work", authority: ["coordinate"], truthfulness: "report evidence", safety: "escalate risk", prohibitedBehavior: ["invent evidence"] },
  taskClassAdjustment: { roleId: "concertmaster", taskClass: "implementation", version: 2, delta: {}, reason: "implementation" },
  missionOverlay: {},
  candidates: [{ candidate: { ...candidate, candidateId, version: 2, contentHash: "c".repeat(64), parentCandidateId: null, state: "candidate" as const, authorId: "operator", sessionRef: "session", createdAt: "2026-01-01T00:00:00.000Z" }, candidateId, version: 2, state: "candidate", changedAxes: ["caution"], decision: "pending", invalidated: false }],
  rollouts: [],
} satisfies PersonaInspection;

function api(): PersonaApi {
  return {
    getPersona: vi.fn(async () => inspection),
    proposePersona: vi.fn(async () => inspection.candidates[0]!.candidate!),
    editPersonaCandidate: vi.fn(async () => inspection.candidates[0]!.candidate!),
  };
}

describe("persona-data server boundary", () => {
  it("loads the persona inspection with the exact project, Goal, role, and task query", async () => {
    const client = api();
    await expect(getPersona(client, query)).resolves.toBe(inspection);
    expect(client.getPersona).toHaveBeenCalledWith(query);
  });

  it("proposes a candidate with the caller's fresh idempotency command", async () => {
    const client = api();
    await proposePersona(client, input, "55555555-5555-4555-8555-555555555555");
    expect(client.proposePersona).toHaveBeenCalledWith(input, "55555555-5555-4555-8555-555555555555");
  });

  it("edits the selected candidate through the server without optimistic local mutation", async () => {
    const client = api();
    const result = await editPersonaCandidate(client, candidateId, input, "66666666-6666-4666-8666-666666666666");
    expect(result).toBe(inspection.candidates[0]!.candidate);
    expect(client.editPersonaCandidate).toHaveBeenCalledWith(candidateId, input, "66666666-6666-4666-8666-666666666666");
  });

  it("preserves a server candidate version conflict for the UI to explain", async () => {
    const client = api();
    vi.mocked(client.editPersonaCandidate).mockRejectedValueOnce(new ApiError(409, "version_conflict", "Candidate version conflict", "expected 3, got 2"));
    await expect(editPersonaCandidate(client, candidateId, input, "77777777-7777-4777-8777-777777777777"))
      .rejects.toMatchObject({ status: 409, code: "version_conflict", detail: "expected 3, got 2" });
  });

  it("does not confuse an active profile version with a candidate version", () => {
    expect(inspection.version).toBe(7);
    expect(inspection.candidates[0]!.version).toBe(2);
    expect(isActivePersonaCandidate(inspection, candidateId)).toBe(false);
  });
});
