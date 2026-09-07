import type { CursorEvent } from "../activity-stream.js";
import { fitPlain, tuiTheme } from "../theme.js";

interface TimelineEvent extends CursorEvent {
  eventType: string;
}

export function renderActivityTimeline(events: readonly TimelineEvent[], width: number): string[] {
  if (events.length === 0) return [tuiTheme.dim("  No activity yet.")];
  return events.map((event) => {
    const line = fitPlain(`  ● #${event.cursor}  ${event.eventType}`, width);
    return tuiTheme.secondary(line);
  });
}
