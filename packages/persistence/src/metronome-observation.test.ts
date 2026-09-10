import { describe, expect, it, vi } from "vitest";
import * as metronome from "./metronome.js";

describe("Metronome approval observation", () => {
  it("surfaces decisions, interruptions, effects, and failures without a ledger write", async () => {
    const journalRows = [
      { journal_id: "j1", goal_id: "g1", capability_kind: "ipython", approval_id: "a1", command_id: "c1", event: "approval", details: { tier: "user" }, recorded_at: new Date("2026-01-01T00:00:00Z") },
      { journal_id: "j2", goal_id: "g1", capability_kind: "ipython", approval_id: "a1", command_id: "c1", event: "rejection", details: { reason: "not approved" }, recorded_at: new Date("2026-01-01T00:00:01Z") },
      { journal_id: "j3", goal_id: "g1", capability_kind: "ipython", approval_id: "a1", command_id: "c1", event: "safer_alternative", details: { alternative: "review-only" }, recorded_at: new Date("2026-01-01T00:00:02Z") },
      { journal_id: "j4", goal_id: "g1", capability_kind: "ipython", approval_id: "a1", command_id: "c1", event: "interruption", details: { stage: "stop", outcome: "stopped", intentCount: 2, appliedCount: 1, skippedCount: 1 }, recorded_at: new Date("2026-01-01T00:00:03Z") },
      { journal_id: "j5", goal_id: "g1", capability_kind: "ipython", approval_id: "a1", command_id: "c1", event: "effect_result", details: { outcome: "resolved_confirmed", index: 0 }, recorded_at: new Date("2026-01-01T00:00:04Z") },
      { journal_id: "j6", goal_id: "g1", capability_kind: "ipython", approval_id: null, command_id: "c2", event: "failure", details: { error: "provider unavailable" }, recorded_at: new Date("2026-01-01T00:00:05Z") },
    ];
    const query = vi.fn(async (sql: string) => sql.includes("pending.command_id")
      ? { rows: [{ command_id: "c3", effect_index: 0, admission_command_id: "admission-3" }], rowCount: 1 }
      : { rows: journalRows, rowCount: journalRows.length });
    const observer = (metronome as unknown as { observeCapabilityDecisions?: Function }).observeCapabilityDecisions;
    expect(typeof observer).toBe("function");
    if (typeof observer !== "function") return;

    const observed = await observer({ query }, "ipython", "p1", "g1");
    expect(observed.decisions.map((entry: { event: string }) => entry.event)).toEqual([
      "approval", "rejection", "safer_alternative", "interruption", "effect_result", "failure",
    ]);
    expect(observed.decisions[3].details).toMatchObject({ outcome: "stopped", appliedCount: 1, skippedCount: 1 });
    expect(observed.pendingEffects).toEqual([{ commandId: "c3", effectIndex: 0, admissionCommandId: "admission-3" }]);
    expect(query).toHaveBeenCalledWith(expect.stringMatching(/^SELECT /), expect.any(Array));
    expect(query.mock.calls.every(([statement]) => !/\b(INSERT|UPDATE|DELETE)\b/i.test(String(statement)))).toBe(true);
  });
});
