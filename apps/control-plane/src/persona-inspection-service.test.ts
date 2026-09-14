import { describe, expect, it, vi } from "vitest";
import { PersonaInspectionError, createPersonaInspectionService, summarizePersonaCandidateHistory } from "./persona-inspection-service.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const operator = { operatorId: "33333333-3333-4333-8333-333333333333", credentialId: "44444444-4444-4444-8444-444444444444" };

describe("persona inspection service", () => {
  it("marks an evaluated predecessor as invalidated when a candidate revision remains pending", () => {
    const candidate = { candidateId: "55555555-5555-4555-8555-555555555555", version: 2, state: "candidate", changes: [{ axis: "caution" }], contentHash: "a".repeat(64) };
    const summary = summarizePersonaCandidateHistory({ candidate, evaluation: { candidateVersion: 1 }, council: null } as never);
    expect(summary).toMatchObject({ candidateId: candidate.candidateId, version: 2, decision: "candidate", invalidated: true });
  });

  it("rejects an authority edit before any candidate write through the real service", async () => {
    const withGoalLease = vi.fn();
    const service = createPersonaInspectionService({ pool: {} as never, withGoalLease });
    const candidate = { kind: "persona_axis", projectId, goalId, target: { roleId: "concertmaster", taskClass: "implementation" }, changes: [{ axis: "authority", currentValue: 0, proposedValue: 1 }] };
    await expect(service.propose({ projectId, goalId, candidate }, goalId, operator)).rejects.toBeInstanceOf(PersonaInspectionError);
    expect(withGoalLease).not.toHaveBeenCalled();
  });
});
