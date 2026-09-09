import type { CursorEvent } from "../activity-stream.js";
import { fitPlain, transcriptPaint, tuiTheme, type TranscriptKind } from "../theme.js";

export interface ActivityEffectGate {
  readonly actor: string;
  readonly action: string;
  readonly target: string;
  readonly classification: "ordinary" | "critical" | "forbidden" | "ambiguous";
  readonly outcome: string;
  readonly reason?: string;
  readonly kind: TranscriptKind;
}

export interface ActivityTimelineEvent extends CursorEvent {
  readonly eventType: string;
  readonly effect?: ActivityEffectGate;
}

function effectVerb(action: string): string {
  if (action === "project.file.edit") return "editing";
  if (action === "project.test.run") return "running";
  if (action.startsWith("git.local.")) return "git";
  return action;
}

function renderEffect(event: ActivityTimelineEvent, width: number): string {
  const effect = event.effect!;
  const reason = effect.reason === undefined ? "" : `  reason: ${effect.reason}`;
  const line = `  ● #${event.cursor}  ${effect.actor}  ${effectVerb(effect.action)} ${effect.target}  ${effect.classification} · ${effect.outcome}${reason}`;
  return transcriptPaint(effect.kind)(fitPlain(line, width));
}

export function renderActivityTimeline(events: readonly ActivityTimelineEvent[], width: number): string[] {
  if (events.length === 0) return [tuiTheme.dim("  No activity yet.")];
  return events.map((event) => {
    if (event.effect !== undefined) return renderEffect(event, width);
    const line = fitPlain(`  ● #${event.cursor}  ${event.eventType}`, width);
    return tuiTheme.secondary(line);
  });
}
