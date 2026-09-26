import { describe, expect, it } from "vitest";
import type { OvertureEvent, OvertureMessage } from "@maestro/contracts";
import { buildSessionTimeline, overtureRoleLabel, projectOpenOvertureClarification, projectToolActivity } from "./session-timeline.js";

const ids = {
  run: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  conversation: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  project: "11111111-1111-4111-8111-111111111111",
  turn: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
};

function overtureMessage(messageId: string, actor: OvertureMessage["actor"], content: string, createdAt: string): OvertureMessage {
  return {
    messageId,
    runId: ids.run,
    conversationId: ids.conversation,
    projectId: ids.project,
    turnId: ids.turn,
    cursor: "1",
    actor,
    modelRef: actor === "operator" ? null : "openai-codex/gpt-5.6-sol",
    content,
    createdAt,
  };
}

describe("session timeline", () => {
  it("interleaves Concertmaster turns and Overture replies by time without duplicating operator text", () => {
    const timeline = buildSessionTimeline(
      [
        { id: "u1", role: "operator", content: "Plan the release", createdAt: "2026-09-26T00:00:00.000Z" },
        { id: "a1", role: "concertmaster", content: "On it", createdAt: "2026-09-26T00:00:02.000Z" },
      ],
      [
        overtureMessage("aaaaaaaa-0000-4000-8000-000000000001", "operator", "Plan the release", "2026-09-26T00:00:01.000Z"),
        overtureMessage("aaaaaaaa-0000-4000-8000-000000000002", "conversation-lead", "Which repository?", "2026-09-26T00:00:03.000Z"),
      ],
    );
    expect(timeline.map((item) => [item.author, item.content])).toEqual([
      ["operator", "Plan the release"],
      ["concertmaster", "On it"],
      ["overture", "Which repository?"],
    ]);
    expect(timeline[2]!.role).toBe("conversation-lead");
  });

  it("keeps optimistic items until the durable copy arrives", () => {
    const pending = [{ id: "p1", author: "operator" as const, content: "Hello", createdAt: "2026-09-26T00:00:05.000Z", pending: true }];
    expect(buildSessionTimeline([], [], pending)).toHaveLength(1);
    expect(buildSessionTimeline([{ id: "u1", role: "operator", content: "Hello", createdAt: "2026-09-26T00:00:05.000Z" }], [], pending)).toEqual([
      { id: "u1", author: "operator", content: "Hello", createdAt: "2026-09-26T00:00:05.000Z" },
    ]);
  });

  it("labels crew roles for display", () => {
    expect(overtureRoleLabel("conversation-lead")).toBe("conversation lead");
    expect(overtureRoleLabel(undefined)).toBe("overture");
  });

  it("projects the currently open clarification", () => {
    const base = { runId: ids.run, projectId: ids.project, createdAt: "2026-09-24T00:00:00.000Z" };
    const events = [
      { ...base, eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", cursor: "1", eventType: "clarification_opened", payload: { clarificationId: "c1", question: "Which repository?" } },
    ] as unknown as OvertureEvent[];
    expect(projectOpenOvertureClarification(events)).toEqual({ clarificationId: "c1", question: "Which repository?" });
    const answered = [
      ...events,
      { ...base, eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab", cursor: "2", eventType: "clarification_answered", payload: { clarificationId: "c1" } },
    ] as unknown as OvertureEvent[];
    expect(projectOpenOvertureClarification(answered)).toBeUndefined();
  });

  it("turns crew tool events into activity lines ordered with the chat", () => {
    const base = { runId: ids.run, projectId: ids.project, cursor: "1", eventType: "tool_activity" };
    const activity = projectToolActivity([
      { ...base, eventId: "e1", createdAt: "2026-09-26T00:00:01.500Z", payload: { roleId: "design-mock-specialist", kind: "write_file", status: "ok", path: "design/signup.html", detail: "2048 bytes" } },
      { ...base, eventId: "e2", createdAt: "2026-09-26T00:00:01.200Z", payload: { roleId: "design-mock-specialist", kind: "python", status: "ok", detail: 'html = """<main>' } },
      { ...base, eventId: "e3", createdAt: "2026-09-26T00:00:01.700Z", payload: { roleId: "security-evaluator", kind: "read_file", status: "error", path: "x.md", detail: "Workspace file not found" } },
      { ...base, eventId: "e4", createdAt: "2026-09-26T00:00:01.800Z", eventType: "message_appended", payload: {} },
    ] as unknown as OvertureEvent[]);
    expect(activity.map((item) => [item.role, item.content])).toEqual([
      ["design-mock-specialist", "wrote design/signup.html (2048 bytes)"],
      ["design-mock-specialist", 'ran Python: html = """<main>'],
      ["security-evaluator", "read x.md — failed: Workspace file not found"],
    ]);
    const timeline = buildSessionTimeline([{ id: "u1", role: "operator", content: "Mock it", createdAt: "2026-09-26T00:00:01.000Z" }], [], [], activity);
    expect(timeline.map((item) => item.id)).toEqual(["u1", "e2", "e1", "e3"]);
  });
});
