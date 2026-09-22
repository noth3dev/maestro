import { z } from "zod";

export const SettingsPreferencesSchema = z.object({
  compactSidebar: z.boolean(),
  desktopPush: z.boolean(),
  emailDigest: z.boolean(),
  slackWebhook: z.boolean(),
}).strict();
export type SettingsPreferences = z.infer<typeof SettingsPreferencesSchema>;

export const SettingsAuthorityDefaultsSchema = z.object({
  spendCeilingCents: z.number().int().nonnegative(),
  criticalActionsRequireApproval: z.boolean(),
  allowFlashmob: z.boolean(),
}).strict();
export type SettingsAuthorityDefaults = z.infer<typeof SettingsAuthorityDefaultsSchema>;

export const SettingsModelSchema = z.object({
  modelRef: z.string().min(3),
  score: z.number().min(0).max(200).nullable(),
  inUse: z.boolean(),
}).strict();
export type SettingsModel = z.infer<typeof SettingsModelSchema>;

export const SettingsProviderSchema = z.object({
  providerId: z.string().min(1),
  connected: z.boolean(),
  authModes: z.array(z.enum(["api-key", "managed-subscription"])),
}).strict();
export type SettingsProvider = z.infer<typeof SettingsProviderSchema>;

export const SettingsReadSchema = z.object({
  preferences: SettingsPreferencesSchema,
  authorityDefaults: SettingsAuthorityDefaultsSchema,
  models: z.array(SettingsModelSchema),
  providers: z.array(SettingsProviderSchema),
}).strict();
export type SettingsRead = z.infer<typeof SettingsReadSchema>;

export const SettingsPreferencesUpdateSchema = SettingsPreferencesSchema.partial().strict();
export type SettingsPreferencesUpdate = z.infer<typeof SettingsPreferencesUpdateSchema>;
export const SettingsModelPoolUpdateSchema = z.object({ modelRef: z.string().min(3), inUse: z.boolean() }).strict();
export type SettingsModelPoolUpdate = z.infer<typeof SettingsModelPoolUpdateSchema>;
export const SettingsAuthorityDefaultsUpdateSchema = SettingsAuthorityDefaultsSchema.partial().strict();
export type SettingsAuthorityDefaultsUpdate = z.infer<typeof SettingsAuthorityDefaultsUpdateSchema>;

export const SettingsModelPoolConfigSchema = z.object({ schemaVersion: z.literal(1), enabledModelRefs: z.array(z.string().min(3)).superRefine((refs, ctx) => { if (new Set(refs).size !== refs.length) ctx.addIssue({ code: "custom", message: "enabledModelRefs must not contain duplicates" }); }) }).strict();
export type SettingsModelPoolConfig = z.infer<typeof SettingsModelPoolConfigSchema>;
