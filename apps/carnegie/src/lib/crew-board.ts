import type { TimelineItem } from "./session-timeline.js";

/** `@handle` → role, mirroring the handles the crew is told to use. */
const HANDLES: Record<string, string> = {
  lead: "conversation-lead",
  architecture: "architecture-analyst",
  architect: "architecture-analyst",
  security: "security-evaluator",
  design: "design-mock-specialist",
  designer: "design-mock-specialist",
  task: "task-editor",
  review: "plan-reviewer",
  reviewer: "plan-reviewer",
  critic: "plan-reviewer",
};

export type CrewAsk = {
  id: string;
  from: string;
  to: string;
  /** The line that carried the request, without the handle. */
  text: string;
  done: boolean;
};

/**
 * Requests crew members made of each other with @handles. An ask is done once
 * the addressed role speaks after it.
 */
export function crewAsks(timeline: readonly TimelineItem[]): CrewAsk[] {
  const asks: CrewAsk[] = [];
  timeline.forEach((item, index) => {
    if (item.author !== "overture" || item.role === undefined) return;
    for (const [lineIndex, line] of item.content.split("\n").entries()) {
      for (const match of line.matchAll(/@([a-z-]+)/gi)) {
        const to = HANDLES[match[1]!.toLowerCase()];
        if (to === undefined || to === item.role) continue;
        const id = `${item.id}:${lineIndex}:${to}`;
        if (asks.some((ask) => ask.id === id)) continue;
        // The request is what follows the handle, up to the next handle.
        const after = line.slice((match.index ?? 0) + match[0].length);
        const text = after.split(/@[a-z-]+/i)[0]!.replace(/^[\s,:;.-]+/, "").trim();
        const done = timeline.slice(index + 1).some((later) => later.author === "overture" && later.role === to);
        asks.push({ id, from: item.role, to, text: text === "" ? "(no details)" : text, done });
      }
    }
  });
  return asks;
}
