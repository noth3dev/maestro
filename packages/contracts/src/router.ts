import { z } from "zod";
import { ModelRefSchema } from "./schemas/common.js";

export const RouterRuntimeModeSchema = z.enum(["ensemble", "pin"]);
export type RouterRuntimeMode = z.infer<typeof RouterRuntimeModeSchema>;

export const RouterRowStateSchema = z.enum([
  "routable",
  "pool-disabled",
  "live-unavailable",
  "unprofiled",
  "not-a-candidate",
  "catalog-ready",
]);
export type RouterRowState = z.infer<typeof RouterRowStateSchema>;

const UniqueModelRefsSchema = z.array(ModelRefSchema).superRefine((refs, context) => {
  if (new Set(refs).size !== refs.length) context.addIssue({ code: "custom", message: "model references must not contain duplicates" });
});

export const RouterConfigInputSchema = z.object({ schemaVersion: z.literal(1), enabledModelRefs: UniqueModelRefsSchema }).strict();
export type RouterConfigInput = z.infer<typeof RouterConfigInputSchema>;

const RouterCatalogBaselineSchema = z
  .object({
    present: z.boolean(),
    score: z.number().int().min(0).max(200).nullable(),
    reviewedAt: z.string().datetime().optional(),
  })
  .strict();
const RouterCatalogLiveSchema = z
  .object({
    present: z.boolean(),
    capabilities: z.array(z.string().min(1)),
    authModes: z.array(z.enum(["api-key", "managed-subscription"])),
    regions: z.array(z.string().min(1)),
  })
  .strict();
const RouterCatalogCandidateSchema = z
  .object({
    present: z.boolean(),
    candidateRefs: z.array(z.string().min(1)),
    accountBindings: z.array(z.string().min(1)),
  })
  .strict();

export const RouterCatalogEntrySchema = z
  .object({
    modelRef: ModelRefSchema,
    providerId: z.string().min(1),
    modelId: z.string().min(1),
    baseline: RouterCatalogBaselineSchema,
    live: RouterCatalogLiveSchema,
    candidate: RouterCatalogCandidateSchema,
    inUse: z.boolean(),
    state: RouterRowStateSchema,
  })
  .strict();
export type RouterCatalogEntry = z.infer<typeof RouterCatalogEntrySchema>;

export const RouterCatalogReadSchema = z
  .object({
    mode: RouterRuntimeModeSchema,
    active: z.boolean(),
    status: z.enum(["ready", "inactive", "partial"]),
    reason: z.string().min(1).optional(),
    poolModelRefs: UniqueModelRefsSchema,
    entries: z.array(RouterCatalogEntrySchema),
  })
  .strict();
export type RouterCatalogRead = z.infer<typeof RouterCatalogReadSchema>;

export const RouterConfigValidationSchema = z
  .object({
    valid: z.boolean(),
    enabledModelRefs: UniqueModelRefsSchema,
    unknownModelRefs: UniqueModelRefsSchema,
    changes: z
      .array(z.object({ modelRef: ModelRefSchema, previousInUse: z.boolean(), nextInUse: z.boolean() }).strict())
      .refine(
        (changes) => new Set(changes.map((change) => change.modelRef)).size === changes.length,
        "changes must not contain duplicates",
      ),
  })
  .strict();
export type RouterConfigValidation = z.infer<typeof RouterConfigValidationSchema>;
