import { z } from "zod";
import { sha256Hex } from "@maestro/domain/hash";

export const UuidSchema = z.uuid();
export const CommandVersionSchema = z.number().int().min(0);

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}
export function taskDemandHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/** Project identities visible to the authenticated operator for workspace attachment. */
export const ProjectListSchema = z.object({ projects: z.array(UuidSchema) }).strict();
export type ProjectList = z.infer<typeof ProjectListSchema>;

export const NonEmptyStringListSchema = z.array(z.string().min(1)).readonly();

export const ModelRefSchema = z
  .string()
  .regex(/^[^\s/]+\/[^\s/]+$/)
  .max(320);
export type ModelRef = z.infer<typeof ModelRefSchema>;

export const ActionClassificationSchema = z.enum(["ordinary", "critical", "forbidden", "ambiguous"]);
export type ActionClassification = z.infer<typeof ActionClassificationSchema>;

/** Single-effect budget cap: ten million dollars expressed in cents. */
export const MaxBudgetEffectCents = 1_000_000_000;
export const BudgetEffectCentsSchema = z.number().int().nonnegative().safe().max(MaxBudgetEffectCents);
