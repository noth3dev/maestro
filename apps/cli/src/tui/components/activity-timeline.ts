import type { CursorEvent } from "../activity-stream.js";

interface TimelineEvent extends CursorEvent {
  eventType: string;
}

export function renderActivityTimeline(events: readonly TimelineEvent[], width: number): string[] {
  if (events.length === 0) return ["No activity yet."];
  return events.map((event) => {
    const line = `✓ [${event.cursor}] ${event.eventType}`;
    return line.length <= width ? line : `${line.slice(0, Math.max(0, width - 1))}…`;
  });
}
