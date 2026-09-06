import { createHash } from "node:crypto";
import { canonicalJson } from "./task-contract.js";

export const IMPROVEMENT_DIGEST_SCHEMA_VERSION = 1 as const;

export type ImprovementDigestTrigger =
  | "worker_completed" | "worker_failed" | "worker_cancelled" | "department_handoff"
  | "council_decision" | "goal_completed" | "goal_failed" | "goal_rollback"
  | "incident_closed" | "cost_threshold" | "quality_signal";

export type ImprovementDigestSourceKind =
  | "goal" | "evidence_record" | "evidence_bundle" | "metronome_finding"
  | "discord_improvement_evidence" | "encore_round";

export interface ImprovementDigestSourceRef { readonly kind: ImprovementDigestSourceKind; readonly sourceId: string; }
export interface ImprovementDigestMetric { readonly name: string; readonly value: number; readonly unit: string; }

export interface ImprovementDigestInput {
  readonly schemaVersion: typeof IMPROVEMENT_DIGEST_SCHEMA_VERSION;
  readonly projectId: string;
  readonly goalId: string;
  readonly episodeId: string;
  readonly trigger: ImprovementDigestTrigger;
  readonly situation: string;
  readonly selectedDecision: string;
  readonly rejectedAlternatives: readonly string[];
  readonly observedResult: string;
  readonly metrics: readonly ImprovementDigestMetric[];
  readonly confidence: number;
  readonly sourceRefs: readonly ImprovementDigestSourceRef[];
}

export interface ImprovementDigest extends ImprovementDigestInput {
  readonly digestId: string;
  readonly contentHash: string;
  readonly authorId: string;
  readonly sessionRef: string;
  readonly createdAt: string;
}

export class InvalidImprovementDigestError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidImprovementDigestError"; }
}

const TRIGGERS: readonly ImprovementDigestTrigger[] = [
  "worker_completed", "worker_failed", "worker_cancelled", "department_handoff", "council_decision",
  "goal_completed", "goal_failed", "goal_rollback", "incident_closed", "cost_threshold", "quality_signal",
];
const SOURCE_KINDS: readonly ImprovementDigestSourceKind[] = ["goal", "evidence_record", "evidence_bundle", "metronome_finding", "discord_improvement_evidence", "encore_round"];
const SECRET_FIELD = /(^|[^a-z])(password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|credential)([^a-z]|$)/i;
const SECRET_LIKE = /(?:authorization\s*:\s*bearer\s+|bearer\s+|password\s*[:=]|passwd\s*[:=]|secret\s*[:=]|api[_-]?key\s*[:=]|access[_-]?token\s*[:=]|private[_-]?key|credential\s*[:=]|-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----|(?:^|[^a-z0-9])(?:sk|pk)-[a-z0-9_-]{16,}(?:$|[^a-z0-9])|eyj[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+|AKIA[0-9A-Z]{16}|gh[pousr]_[a-z0-9]{20,}|AIza[0-9a-z_-]{20,}|xox[baprs]-[0-9a-z-]{20,}|hf_[a-z0-9]{20,})/i;
const MAX_TEXT = 4096;
const MAX_EPISODE = 256;
const MAX_LIST = 16;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value: unknown, field: string, max = MAX_TEXT): asserts value is string {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\0") || value.length > max || SECRET_LIKE.test(value)) throw new InvalidImprovementDigestError(`${field} must be bounded, nonblank, and free of secret-like material`);
}
function id(value: unknown, field: string): asserts value is string {
  text(value, field, MAX_EPISODE);
  if (!UUID.test(value)) throw new InvalidImprovementDigestError(`${field} must be a durable UUID`);
}
function episode(value: unknown, field: string): asserts value is string { text(value, field, MAX_EPISODE); }
export function assertSafeImprovementDigestText(value: unknown, field: string, max = MAX_TEXT): asserts value is string { text(value, field, max); }
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new InvalidImprovementDigestError(`Improvement Digest has unknown field ${key}`);
}

export function assertValidImprovementDigestInput(value: unknown): asserts value is ImprovementDigestInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidImprovementDigestError("Improvement Digest must be an object");
  const r = value as Record<string, unknown>;
  keys(r, ["schemaVersion", "projectId", "goalId", "episodeId", "trigger", "situation", "selectedDecision", "rejectedAlternatives", "observedResult", "metrics", "confidence", "sourceRefs"]);
  if (r.schemaVersion !== IMPROVEMENT_DIGEST_SCHEMA_VERSION) throw new InvalidImprovementDigestError("Improvement Digest schema version is not supported");
  id(r.projectId, "projectId"); id(r.goalId, "goalId"); episode(r.episodeId, "episodeId");
  if (!TRIGGERS.includes(r.trigger as ImprovementDigestTrigger)) throw new InvalidImprovementDigestError("Improvement Digest trigger is not allowed");
  text(r.situation, "situation"); text(r.selectedDecision, "selectedDecision"); text(r.observedResult, "observedResult");
  if (!Array.isArray(r.rejectedAlternatives) || r.rejectedAlternatives.length > MAX_LIST) throw new InvalidImprovementDigestError("Improvement Digest rejected alternatives are unbounded");
  for (const [index, alternative] of r.rejectedAlternatives.entries()) text(alternative, `rejectedAlternatives[${index}]`);
  if (!Array.isArray(r.metrics) || r.metrics.length > MAX_LIST) throw new InvalidImprovementDigestError("Improvement Digest metrics are unbounded");
  for (const [index, metricValue] of r.metrics.entries()) {
    if (!metricValue || typeof metricValue !== "object" || Array.isArray(metricValue)) throw new InvalidImprovementDigestError(`metrics[${index}] must be an object`);
    const metric = metricValue as Record<string, unknown>; keys(metric, ["name", "value", "unit"]); text(metric.name, `metrics[${index}].name`, 128); text(metric.unit, `metrics[${index}].unit`, 64);
    if (SECRET_FIELD.test(metric.name) || SECRET_FIELD.test(metric.unit)) throw new InvalidImprovementDigestError(`metrics[${index}] names cannot identify secret material`);
    if (typeof metric.value !== "number" || !Number.isFinite(metric.value)) throw new InvalidImprovementDigestError(`metrics[${index}].value must be finite`);
    const magnitude = Math.abs(metric.value);
    if (magnitude !== 0 && (magnitude < 1e-6 || magnitude >= 1e21)) throw new InvalidImprovementDigestError(`metrics[${index}].value must use stable JSON encoding`);
  }
  if (typeof r.confidence !== "number" || !Number.isFinite(r.confidence) || r.confidence < 0 || r.confidence > 1) throw new InvalidImprovementDigestError("Improvement Digest confidence must be in [0,1]");
  if (r.confidence !== 0 && r.confidence < 1e-6) throw new InvalidImprovementDigestError("Improvement Digest confidence must use stable JSON encoding");
  if (!Array.isArray(r.sourceRefs) || r.sourceRefs.length === 0 || r.sourceRefs.length > MAX_LIST) throw new InvalidImprovementDigestError("Improvement Digest requires bounded source references");
  const seen = new Set<string>();
  for (const [index, sourceValue] of r.sourceRefs.entries()) {
    if (!sourceValue || typeof sourceValue !== "object" || Array.isArray(sourceValue)) throw new InvalidImprovementDigestError(`sourceRefs[${index}] must be an object`);
    const source = sourceValue as Record<string, unknown>; keys(source, ["kind", "sourceId"]);
    if (!SOURCE_KINDS.includes(source.kind as ImprovementDigestSourceKind)) throw new InvalidImprovementDigestError(`sourceRefs[${index}].kind is not allowed`);
    id(source.sourceId, `sourceRefs[${index}].sourceId`);
    const identity = `${source.kind}:${source.sourceId.toLowerCase()}`; if (seen.has(identity)) throw new InvalidImprovementDigestError("Improvement Digest source references must be unique"); seen.add(identity);
  }
}

export function normalizeImprovementDigestInput(value: ImprovementDigestInput): ImprovementDigestInput {
  assertValidImprovementDigestInput(value);
  return {
    ...value,
    projectId: value.projectId.toLowerCase(),
    goalId: value.goalId.toLowerCase(),
    sourceRefs: value.sourceRefs.map((source) => ({ ...source, sourceId: source.sourceId.toLowerCase() })),
  };
}

export function improvementDigestContentHash(value: ImprovementDigestInput): string {
  return createHash("sha256").update(canonicalJson(normalizeImprovementDigestInput(value)), "utf8").digest("hex");
}
