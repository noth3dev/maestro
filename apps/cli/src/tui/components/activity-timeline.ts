import type { GoalEvent } from "@maestro/contracts";
import type { CursorEvent } from "../activity-stream.js";
import type { PendingDecision } from "./shell.js";
import { fitPlain, transcriptPaint, tuiTheme, type TranscriptKind } from "../theme.js";

export interface ActivityEffectGate {
  readonly actor: string;
  readonly identity?: string;
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
  const source = isRecord(payload.effect) ? payload.effect : isRecord(payload.details) ? payload.details : payload;
  const actor = textField(source.actor) ?? textField(source.actorId);
  const action = textField(source.action);
  const target = textField(source.target);
  const rawClassification = source.classification;
  const classification: ActivityEffectGate["classification"] | undefined = rawClassification === "ordinary" || rawClassification === "critical" || rawClassification === "forbidden" || rawClassification === "ambiguous" ? rawClassification : undefined;
  const outcome = textField(source.outcome);
  const reason = textField(source.reason);
  const identity = textField(source.effectId) ?? textField(source.effect_id) ?? (textField(source.commandId) !== undefined && textField(source.index) !== undefined ? `${textField(source.commandId)}:${textField(source.index)}` : undefined);
  const effect = actor !== undefined && action !== undefined && target !== undefined && classification !== undefined && outcome !== undefined
    ? { actor, ...(identity === undefined ? {} : { identity }), action, target, classification, outcome, ...(reason === undefined ? {} : { reason }), kind: sourceTranscriptKind(source.kind) }
    : undefined;
  return { cursor: event.cursor, eventId: event.eventId, eventType: event.eventType, ...(effect === undefined ? {} : { effect }) };
}

function effectVerb(action: string): string {
  if (action === "project.file.edit") return "editing";
  if (action === "project.test.run") return "running";
  if (action.startsWith("git.local.")) return "git";
  return action;
}

function effectGlyph(effect: ActivityEffectGate, eventType: string): string {
  const outcome = effect.outcome.toLowerCase();
  if (eventType.includes("awaiting") || outcome.includes("awaiting")) return "⏸";
  if (effect.classification === "forbidden" || effect.kind === "error" || outcome.includes("denied")) return "✗";
  if (effect.kind === "success" || outcome === "auto" || outcome.includes("completed") || outcome.includes("approved")) return "✓";
  return "●";
}

function renderEffect(event: ActivityTimelineEvent, width: number): string {
  const effect = event.effect!;
  const reason = effect.reason === undefined ? "" : `  reason: ${effect.reason}`;
  const line = `  ${effectGlyph(effect, event.eventType)} #${event.cursor}  ${effect.actor}  ${effectVerb(effect.action)} ${effect.target}  ${effect.classification} · ${effect.outcome}${reason}`;
  return transcriptPaint(effect.kind)(fitPlain(line, width));
}

function activityKey(effect: ActivityEffectGate): string {
  return effect.identity ?? `${effect.actor}\u0000${effect.action}\u0000${effect.target}`;
}

function pendingTier(effect: ActivityEffectGate): string {
  const outcome = effect.outcome.toLowerCase();
  if (outcome.includes("user") || outcome.includes("you")) return "You";
  if (outcome.includes("encore")) return "Encore Council";
  if (outcome.includes("department") || outcome.includes("head")) return "Department Head";
  if (effect.classification === "critical") return "Encore Council";
  return "You";
}

/** Reconstruct actionable approvals from the durable activity replay. */
export function pendingDecisionsFromActivity(events: readonly ActivityTimelineEvent[]): PendingDecision[] {
  const pending = new Map<string, PendingDecision>();
  const ordered = [...events].sort((a, b) => {
    try { return Number(BigInt(a.cursor) - BigInt(b.cursor)); } catch { return 0; }
  });
  for (const event of ordered) {
    const effect = event.effect;
    if (effect === undefined) continue;
    const key = activityKey(effect);
    const outcome = effect.outcome.toLowerCase();
    if (event.eventType.includes("awaiting") || outcome.includes("awaiting")) {
      pending.set(key, { tier: pendingTier(effect), action: `${effect.action} ${effect.target}`, actor: effect.actor });
    } else {
      pending.delete(key);
    }
  }
  return [...pending.values()];
}

export function renderActivityTimeline(events: readonly ActivityTimelineEvent[], width: number): string[] {
  if (events.length === 0) return [tuiTheme.dim("  No activity yet.")];
  return events.map((event) => {
    if (event.effect !== undefined) return renderEffect(event, width);
    const line = fitPlain(`  ● #${event.cursor}  ${event.eventType}`, width);
    return tuiTheme.secondary(line);
  });
}
