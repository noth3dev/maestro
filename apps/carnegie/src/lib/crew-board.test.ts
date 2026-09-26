import { describe, expect, it } from "vitest";
import { crewAsks } from "./crew-board.js";
import type { TimelineItem } from "./session-timeline.js";

const item = (id: string, role: string, content: string): TimelineItem => ({ id, author: "overture", role, content, createdAt: `2026-09-26T00:00:0${id}.000Z` });

describe("crew asks", () => {
  it("tracks @requests and marks them done when the addressed role replies", () => {
    const asks = crewAsks([
      { id: "0", author: "operator", content: "@design ignored from operator", createdAt: "2026-09-26T00:00:00.000Z" },
      item("1", "conversation-lead", "Plan drafted.\n@design please mock the sign-up screen.\n@security review consent."),
      item("2", "design-mock-specialist", "Mock written. @review can you check scope?"),
      item("3", "conversation-lead", "@lead talking to myself"),
    ]);
    expect(asks.map((ask) => [ask.from, ask.to, ask.text, ask.done])).toEqual([
      ["conversation-lead", "design-mock-specialist", "please mock the sign-up screen.", true],
      ["conversation-lead", "security-evaluator", "review consent.", false],
      ["design-mock-specialist", "plan-reviewer", "can you check scope?", false],
    ]);
  });
});
