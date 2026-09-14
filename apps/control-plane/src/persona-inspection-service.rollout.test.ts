import { describe, expect, it, vi } from "vitest";

vi.mock("@maestro/persistence", () => ({
  appendImprovementCandidateVersion: vi.fn(),
  assertProjectMembership: vi.fn(),
  readActivePersonaProfile: vi.fn(),
  readImprovementCandidateDecisionHistory: vi.fn(),
  recordImprovementCandidate: vi.fn(),
}));

import { readActivePersonaProfile, readImprovementCandidateDecisionHistory } from "@maestro/persistence";
import { createPersonaInspectionService } from "./persona-inspection-service.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const operator = { operatorId: "33333333-3333-4333-8333-333333333333", credentialId: "44444444-4444-4444-8444-444444444444" };
const rollback = { candidateId: "55555555-5555-4555-8555-555555555555", version: 1, contentHash: "a".repeat(64) };

describe("persona inspection rollout projection", () => {
  it("uses the persisted rollout rollback target once across duplicate candidate histories", async () => {
    vi.mocked(readActivePersonaProfile).mockResolvedValue({
      persona: Object.fromEntries(["agreeableness", "extraversion", "imagination", "realism", "conscientiousness", "caution", "initiative", "empathy", "adaptability", "sociability"].map((axis) => [axis, 0.5])),
      coreIdentity: { mission: "mission", authority: ["coordinate"], truthfulness: "truth", safety: "safety", prohibitedBehavior: ["invent"] },
      layers: { learnedProfile: { version: 1 }, taskClassAdjustment: { roleId: "concertmaster", taskClass: "implementation", version: 1, delta: {}, reason: "baseline" }, missionOverlay: {} },
    } as never);
    vi.mocked(readImprovementCandidateDecisionHistory).mockResolvedValue({
      candidate: { candidateId: "66666666-6666-4666-8666-666666666666", version: 1, state: "candidate", changes: [{ axis: "caution" }] },
      evaluation: null, approval: null, council: null, explanation: { rollback: { candidateId: "old-old-old-old-old-old-old-old", version: 1, contentHash: "b".repeat(64) } },
      rollouts: [{ rolloutId: "77777777-7777-4777-8777-777777777777", status: "active", activeCandidateId: "66666666-6666-4666-8666-666666666666", activeVersion: 1, history: [{ kind: "started", eventId: "88888888-8888-4888-8888-888888888888" }] }],
    } as never);
    const pool = { query: vi.fn() };
    pool.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM improvement_candidates")) return { rowCount: 2, rows: [{ candidate_id: "66666666-6666-4666-8666-666666666666" }, { candidate_id: "99999999-9999-4999-8999-999999999999" }] };
      if (sql.includes("FROM improvement_rollouts")) return { rowCount: 1, rows: [{ rollout_id: "77777777-7777-4777-8777-777777777777", status: "active", active_candidate_id: "66666666-6666-4666-8666-666666666666", active_version: 1, rollback_target: rollback }] };
      throw new Error(`unexpected query: ${sql}`);
    });
    const service = createPersonaInspectionService({ pool: pool as never, withGoalLease: async (_goal, operation) => operation({ goalId, ownerId: operator.operatorId, fencingToken: "1" }) });

    const result = await service.read({ projectId, goalId, roleId: "concertmaster", taskClass: "implementation" }, operator);
    expect(result.rollouts).toHaveLength(1);
    expect(result.rollouts[0]).toMatchObject({ rolloutId: "77777777-7777-4777-8777-777777777777", rollbackTarget: rollback });
  });
});
