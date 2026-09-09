import type { GoalEvent } from "@maestro/contracts";
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


function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function textField(value: unknown): string | undefined { return typeof value === "string" && value.trim() !== "" ? value : undefined; }
function sourceTranscriptKind(value: unknown): TranscriptKind {
  return value === "error" || value === "success" || value === "system" || value === "warning" || value === "text" ? value : "system";
}

/** Convert the durable GoalEvent payload into the renderer's typed view model. */
export function toActivityTimelineEvent(event: GoalEvent): ActivityTimelineEvent {
  const payload = isRecord(event.payload) ? event.payload : {};
  const source = isRecord(payload.effect) ? payload.effect : payload;
  const actor = textField(source.actor) ?? textField(source.actorId);
  const action = textField(source.action);
  const target = textField(source.target);
  const rawClassification = source.classification;
  const classification: ActivityEffectGate["classification"] | undefined = rawClassification === "ordinary" || rawClassification === "critical" || rawClassification === "forbidden" || rawClassification === "ambiguous" ? rawClassification : undefined;
  const outcome = textField(source.outcome);
  const reason = textField(source.reason);
  const effect = actor !== undefined && action !== undefined && target !== undefined && classification !== undefined && outcome !== undefined
    ? { actor, action, target, classification, outcome, ...(reason === undefined ? {} : { reason }), kind: sourceTranscriptKind(source.kind) }
    : undefined;
  return { cursor: event.cursor, eventId: event.eventId, eventType: event.eventType, ...(effect === undefined ? {} : { effect }) };
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
