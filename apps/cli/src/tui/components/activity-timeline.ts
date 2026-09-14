import type { GoalEvent } from "@maestro/contracts";
import type { CursorEvent } from "../activity-stream.js";
import type { PendingDecision } from "./shell.js";
import { fitPlain, transcriptPaint, tuiTheme, type TranscriptKind } from "../theme.js";

export type ActivityApprovalTier = "automatic progress" | "Department Head" | "Encore Council" | "user";

export interface ActivityEffectGate {
  readonly actor: string;
  /** Durable effect identity; pending decisions must never infer this from display fields. */
  readonly identity?: string;
  readonly action: string;
  readonly target: string;
  readonly classification: "ordinary" | "critical" | "forbidden" | "ambiguous";
  readonly outcome: string;
  readonly tier?: ActivityApprovalTier;
  readonly reason?: string;
  readonly kind: TranscriptKind;
}

export interface ActivityTimelineEvent extends CursorEvent {
  readonly eventType: string;
  readonly effect?: ActivityEffectGate;
}


function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function textField(value: unknown): string | undefined { return typeof value === "string" && value.trim() !== "" ? value : undefined; }
function indexField(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return textField(value);
}
function approvalTier(value: unknown): ActivityApprovalTier | undefined {
  return value === "automatic progress" || value === "Department Head" || value === "Encore Council" || value === "user" ? value : undefined;
}
function sourceTranscriptKind(value: unknown): TranscriptKind {
  return value === "error" || value === "success" || value === "system" || value === "warning" || value === "text" ? value : "system";
}
function effectIdentity(source: Record<string, unknown>): string | undefined {
  const direct = textField(source.effectId) ?? textField(source.effect_id) ?? textField(source.effectIdentity) ?? textField(source.effect_identity) ?? textField(source.identity);
  if (direct !== undefined) return direct;
  const commandId = textField(source.commandId) ?? textField(source.command_id);
  const index = indexField(source.index ?? source.effectIndex ?? source.effect_index);
  return commandId !== undefined && index !== undefined ? `${commandId}:${index}` : undefined;
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
  const tier = approvalTier(source.tier ?? source.approvalTier ?? source.approval_tier ?? source.requiredTier ?? source.required_tier);
  const reason = textField(source.reason);
  const identity = effectIdentity(source);
  const effect = actor !== undefined && action !== undefined && target !== undefined && classification !== undefined && outcome !== undefined
    ? { actor, ...(identity === undefined ? {} : { identity }), action, target, classification, outcome, ...(tier === undefined ? {} : { tier }), ...(reason === undefined ? {} : { reason }), kind: sourceTranscriptKind(source.kind) }
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

function activityKey(effect: ActivityEffectGate): string | undefined {
  const identity = effect.identity?.trim();
  return identity === undefined || identity === "" ? undefined : identity;
}

function pendingTier(effect: ActivityEffectGate): string | undefined {
  if (effect.tier === undefined) return undefined;
  return effect.tier === "user" ? "You" : effect.tier;
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
    const tier = pendingTier(effect);
    if (key === undefined || tier === undefined) continue;
    const outcome = effect.outcome.toLowerCase();
    if (event.eventType.includes("awaiting") || outcome.includes("awaiting")) {
      pending.set(key, { identity: key, tier, action: `${effect.action} ${effect.target}`, actor: effect.actor });
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
