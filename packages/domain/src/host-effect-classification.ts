import { classifyAction, type ActionClassification } from "@maestro/authority";
import { classifyPressureBand, type PressureBandProjection, type PressureDecisionLayer } from "./pressure-band.js";

export type HostEffectTier = PressureDecisionLayer;

export interface HostEffectClassificationEntry {
  readonly action: string;
  readonly classification: ActionClassification;
  readonly tier: HostEffectTier;
}

export interface HostEffectClassification {
  readonly effects: readonly HostEffectClassificationEntry[];
  readonly pressure: PressureBandProjection;
  readonly tier: HostEffectTier;
}

export class HostEffectClassificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostEffectClassificationError";
  }
}

const TIER_ORDER: readonly HostEffectTier[] = ["automatic progress", "Department Head", "Encore Council", "user"];

function tierRank(tier: HostEffectTier): number {
  return TIER_ORDER.indexOf(tier);
}

function effectTier(classification: ActionClassification): HostEffectTier {
  if (classification === "ordinary") return "automatic progress";
  if (classification === "critical" || classification === "ambiguous") return "user";
  throw new HostEffectClassificationError("Forbidden host effect is denied before approval-tier assignment");
}

function maxTier(left: HostEffectTier, right: HostEffectTier): HostEffectTier {
  return tierRank(left) >= tierRank(right) ? left : right;
}

/** Classify a complete host block before any effect can execute. */
export function classifyHostEffects(actions: readonly string[], pressure: number): HostEffectClassification {
  const pressureProjection = classifyPressureBand(pressure);
  let tier = pressureProjection.decisionLayer;
  const effects: HostEffectClassificationEntry[] = [];
  for (const action of actions) {
    if (typeof action !== "string" || action.trim() === "")
      throw new HostEffectClassificationError("Host effect action must be a non-empty string");
    const classification = classifyAction(action);
    const actionTier = effectTier(classification);
    effects.push({ action, classification, tier: actionTier });
    tier = maxTier(tier, actionTier);
  }
  return { effects: Object.freeze(effects), pressure: pressureProjection, tier };
}
