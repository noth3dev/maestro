import { describe, expect, it } from "vitest";
import { vi } from "vitest";
vi.mock("@maestro/persistence", async () => ({
  ...(await vi.importActual<typeof import("@maestro/persistence")>("@maestro/persistence")),
  raiseMetronomeChallenge: vi.fn().mockResolvedValue({ challengeId: "challenge-1", status: "open" }),
}));
import { createMetronomeService, type WorkerOverlayChallengeInput } from "./metronome-service.js";

describe("Metronome worker overlay challenge", () => {
  it("allows the Metronome to challenge a worker overlay below the role floor", async () => {
    const pool = { query: vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ project_id: "project-1" }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ role_id: "head-security" }] }) } as never;
    const service = createMetronomeService({ pool, withGoalLease: async (_goal, operation) => operation({ goalId: "goal-1", ownerId: "owner", fencingToken: "1" }) });
    const input: WorkerOverlayChallengeInput = { projectId: "project-1", workerId: "worker-1", roleId: "head-security", profile: { caution: 0.5 }, roleFloors: { caution: 0.75 }, evidenceReferences: [] };
    await expect(service.challengeWorkerOverlay("goal-1", input, "cmd-1")).resolves.toMatchObject({ status: "open" });
  });
});
