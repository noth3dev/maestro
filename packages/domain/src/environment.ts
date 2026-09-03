import { createHash } from "node:crypto";
import { canonicalJson } from "./task-contract.js";

export const ENVIRONMENT_RECIPE_SCHEMA_VERSION = 1;
export type EnvironmentType = "local_worktree" | "container_sandbox" | "browser_automation" | "enrolled_device";
export type EnvironmentState = "requested" | "building" | "ready" | "unusable" | "expired" | "cleaning" | "cleaned";
export type CleanupState = "not_scheduled" | "scheduled" | "completed" | "failed";
export interface Capability { readonly name: string; readonly version: string; }
export interface EnvironmentBoundaries { readonly network: readonly string[]; readonly filesystem: readonly string[]; readonly processes: readonly string[]; readonly browsers: readonly string[]; readonly devices: readonly string[]; }
export interface ResourceCeilings { readonly cpuMillis: number; readonly memoryMb: number; readonly diskMb: number; readonly processCount: number; readonly durationSeconds: number; }
export interface EnvironmentRecipe { readonly recipeVersion: number; readonly type: EnvironmentType; readonly recipe: Readonly<Record<string, unknown>>; readonly resolvedInputs: Readonly<Record<string, unknown>>; }
export interface EnvironmentHealth { readonly status: "unknown" | "healthy" | "unhealthy"; readonly checkedAt: string | null; readonly summary: string | null; }
export interface EnvironmentCleanup { readonly status: CleanupState; readonly scheduledAt: string | null; readonly completedAt: string | null; readonly ownedResources: readonly string[]; readonly retainedEvidence: readonly string[]; }
export interface EnvironmentRecord {
 readonly environmentId: string; readonly recipeVersion: number; readonly goalId: string; readonly departmentId: string; readonly workerId: string; readonly projectId: string; readonly missionId: string; readonly type: EnvironmentType;
 readonly recipe: Readonly<Record<string, unknown>>; readonly resolvedInputs: Readonly<Record<string, unknown>>; readonly capabilities: readonly Capability[]; readonly boundaries: EnvironmentBoundaries; readonly secretsReferences: readonly string[]; readonly resources: ResourceCeilings; readonly expiresAt: string; readonly state: EnvironmentState; readonly setupLog: readonly string[]; readonly health: EnvironmentHealth; readonly contentIdentity: string; readonly cleanup: EnvironmentCleanup;
}
export function environmentContentIdentity(recipe: EnvironmentRecipe): string { return createHash("sha256").update(canonicalJson(recipe)).digest("hex"); }
function nonblank(value: unknown): value is string { return typeof value === "string" && value.trim() !== ""; }
export function assertValidEnvironmentRecipe(value: unknown): asserts value is EnvironmentRecipe {
 if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Environment recipe must be an object");
 const r=value as Record<string, unknown>;
 if (r.recipeVersion !== ENVIRONMENT_RECIPE_SCHEMA_VERSION || !["local_worktree","container_sandbox","browser_automation","enrolled_device"].includes(String(r.type))) throw new Error("Invalid environment recipe version or type");
 if (!r.recipe || typeof r.recipe !== "object" || Array.isArray(r.recipe) || !r.resolvedInputs || typeof r.resolvedInputs !== "object" || Array.isArray(r.resolvedInputs)) throw new Error("Recipe and resolved inputs are required");
}
export function assertValidEnvironmentRecord(value: unknown): asserts value is EnvironmentRecord {
 if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Environment record must be an object");
 const r=value as Record<string, unknown>;
 for (const field of ["environmentId","goalId","departmentId","workerId","projectId","missionId","expiresAt","contentIdentity"]) if (!nonblank(r[field])) throw new Error(`Environment ${field} is required`);
 if (!Number.isInteger(r.recipeVersion) || (r.recipeVersion as number) < 1) throw new Error("Environment recipe version is invalid");
 if (!/^[0-9a-f]{64}$/.test(r.contentIdentity as string)) throw new Error("Environment content identity is invalid");
 if (!Array.isArray(r.capabilities) || !r.capabilities.every((c) => c && typeof c === "object" && nonblank((c as Record<string, unknown>).name) && nonblank((c as Record<string, unknown>).version))) throw new Error("Capability manifest is invalid");
 if (Array.isArray(r.secretsReferences) && r.secretsReferences.some((s) => !nonblank(s))) throw new Error("Secret references must be nonblank");
 if (Array.isArray(r.secretsReferences) && r.secretsReferences.some((s) => /secret|password|token|key/i.test(s as string) && (s as string).includes("="))) throw new Error("Secret values are not allowed");
}
