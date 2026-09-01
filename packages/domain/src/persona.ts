import { z } from "zod";

export const PERSONA_AXES = [
  "agreeableness", "extraversion", "imagination", "realism", "conscientiousness",
  "caution", "initiative", "empathy", "adaptability", "sociability",
] as const;

export type PersonaAxis = (typeof PERSONA_AXES)[number];
export type PersonaProfile = Readonly<Record<PersonaAxis, number>>;

const normalizedAxis = z.number().finite().min(0).max(1);
export const personaProfileSchema = z.object({
  agreeableness: normalizedAxis,
  extraversion: normalizedAxis,
  imagination: normalizedAxis,
  realism: normalizedAxis,
  conscientiousness: normalizedAxis,
  caution: normalizedAxis,
  initiative: normalizedAxis,
  empathy: normalizedAxis,
  adaptability: normalizedAxis,
  sociability: normalizedAxis,
}).strict();

/** Validates a complete profile; partial overlays are deliberately outside this durable slice. */
export function parsePersonaProfile(value: unknown): PersonaProfile {
  return personaProfileSchema.parse(value);
}

export const SANE_PERSONA_BASELINE: PersonaProfile = Object.freeze({
  agreeableness: 0.70,
  extraversion: 0.75,
  imagination: 0.65,
  realism: 0.90,
  conscientiousness: 0.95,
  caution: 0.90,
  initiative: 0.92,
  empathy: 0.85,
  adaptability: 0.88,
  sociability: 0.82,
});
