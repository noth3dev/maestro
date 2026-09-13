import { describe, expect, it } from "vitest";
import { vi } from "vitest";
vi.mock("@maestro/persistence", async () => ({
  ...(await vi.importActual<typeof import("@maestro/persistence")>("@maestro/persistence")),
  raiseMetronomeChallenge: vi.fn().mockResolvedValue({ challengeId: "challenge-1", status: "open" }),
}));
import { createMetronomeService, type WorkerOverlayChallengeInput } from "./metronome-service.js";
import { PERSONA_AXES } from "@maestro/domain";

describe("Metronome worker overlay challenge", () => {
  it("allows the Metronome to challenge a worker overlay below the role floor", async () => {
    const durableProfile = Object.fromEntries(PERSONA_AXES.map((axis) => [axis, axis === "caution" ? 0.5 : 0.8]));
    const bounds = PERSONA_AXES.map((axis) => ({ axis, floor_value: axis === "caution" ? "0.75" : "0", ceiling_value: "1" }));
    const pool = { query: vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ project_id: "project-1" }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ status: "running", persona: durableProfile, expires_at: "2099-01-01T00:00:00.000Z" }] })
      .mockResolvedValueOnce({ rowCount: PERSONA_AXES.length, rows: bounds }) } as never;
    const service = createMetronomeService({ pool, withGoalLease: async (_goal, operation) => operation({ goalId: "goal-1", ownerId: "owner", fencingToken: "1" }) });
    const input: WorkerOverlayChallengeInput = { projectId: "project-1", workerId: "worker-1", roleId: "head-security", profile: { caution: 0.5 }, roleFloors: { caution: 0.75 }, evidenceReferences: ["evidence-1"] };
    await expect(service.challengeWorkerOverlay("goal-1", input, "cmd-1")).resolves.toMatchObject({ status: "open" });
  });
});
