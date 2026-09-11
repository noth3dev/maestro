import { z } from "zod";

export const ModelCatalogEntrySchema = z.object({
  identity: z.object({ provider: z.string().min(1), id: z.string().min(1) }).strict(),
  capabilities: z.array(z.string().min(1)),
  authModes: z.array(z.enum(["api-key", "managed-subscription"])),
  dataPolicy: z.object({
    allowedDataClasses: z.array(z.enum(["public", "workspace", "private", "pii", "phi", "secret"])),
    retention: z.enum(["none", "provider-policy", "durable"]),
    trainsOnCustomerData: z.boolean(),
    regions: z.array(z.string().min(1)),
  }).strict(),
}).strict();
export type ModelCatalogEntry = z.infer<typeof ModelCatalogEntrySchema>;

/** Provider login accepts only the two statically registered API-key adapters. */
export const ProviderCredentialLoginInputSchema = z.object({
  providerId: z.enum(["openai", "anthropic"]),
  authMode: z.literal("api-key"),
  secret: z.string().min(1).max(512),
}).strict();
export type ProviderCredentialLoginInput = z.infer<typeof ProviderCredentialLoginInputSchema>;
const ProviderCredentialBindingCommonSchema = {
  bindingId: z.string().min(1).max(128),
  accountRef: z.string().min(1).max(256),
  configuredAt: z.string().datetime(),
} as const;
export const ProviderCredentialBindingSchema = z.union([
  z.object({ ...ProviderCredentialBindingCommonSchema, providerId: z.enum(["openai", "anthropic"]), authMode: z.literal("api-key") }).strict(),
  z.object({ ...ProviderCredentialBindingCommonSchema, providerId: z.literal("openai-codex"), authMode: z.literal("managed-subscription") }).strict(),
]);
export type ProviderCredentialBinding = z.infer<typeof ProviderCredentialBindingSchema>;

/** Browser-based account login is deliberately limited to the public Codex app-server boundary. */
export const ProviderAccountLoginStartInputSchema = z.object({ providerId: z.literal("openai-codex") }).strict();
export type ProviderAccountLoginStartInput = z.infer<typeof ProviderAccountLoginStartInputSchema>;
export const ProviderAccountLoginStartResultSchema = z.object({
  providerId: z.literal("openai-codex"),
  loginId: z.string().min(1).max(256),
  authUrl: z.string().url().max(2048),
}).strict();
export type ProviderAccountLoginStartResult = z.infer<typeof ProviderAccountLoginStartResultSchema>;
export const ProviderAccountLoginStatusSchema = z.object({
  providerId: z.literal("openai-codex"),
  loginId: z.string().min(1).max(256),
  state: z.enum(["pending", "succeeded", "failed", "cancelled", "unknown"]),
  message: z.string().max(512).optional(),
}).strict();
export type ProviderAccountLoginStatus = z.infer<typeof ProviderAccountLoginStatusSchema>;

