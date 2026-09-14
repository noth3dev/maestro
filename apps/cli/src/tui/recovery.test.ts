import { describe, expect, it } from "vitest";
import { reconcileTuiSession } from "./recovery.js";

const session = { workspacePath: "/work/acme", projectId: "11111111-1111-4111-8111-111111111111", goalId: "22222222-2222-4222-8222-222222222222", lastEventCursor: "42" };

describe("TUI session recovery", () => {
  it("reports a new workspace without pretending it is attached", () => {
    expect(reconcileTuiSession("/work/acme", undefined)).toEqual({ kind: "new", message: "No saved Maestro session for this workspace" });
  });

  it("restores identity and cursor without cancelling server-owned work", () => {
    expect(reconcileTuiSession("/work/acme", session)).toEqual({ kind: "attached", projectId: session.projectId, goalId: session.goalId, lastEventCursor: "42" });
  });

  it("marks recovering server state for operator attention", () => {
    expect(reconcileTuiSession("/work/acme", session, { goalState: "recovering", activeWorkers: 1 })).toMatchObject({ kind: "stale", activeWorkers: 1 });
  });
});
