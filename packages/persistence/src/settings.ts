import type { Pool } from "pg";
import type { SettingsAuthorityDefaults, SettingsAuthorityDefaultsUpdate, SettingsModel, SettingsModelPoolUpdate, SettingsPreferences, SettingsPreferencesUpdate, SettingsProvider, SettingsRead } from "@maestro/contracts";

export const DEFAULT_SETTINGS_PREFERENCES: SettingsPreferences = { compactSidebar: false, desktopPush: true, emailDigest: false, slackWebhook: false };
export const DEFAULT_AUTHORITY_DEFAULTS: SettingsAuthorityDefaults = { spendCeilingCents: 5000, criticalActionsRequireApproval: true, allowFlashmob: true };

type ModelSource = { modelRef: string; score: number | null };
export interface SettingsModelSource { list(): Promise<readonly ModelSource[]>; }
export interface SettingsProviderSource { list(): Promise<readonly SettingsProvider[]>; }

function mergePreferences(value: unknown): SettingsPreferences {
  const object = value && typeof value === "object" ? value as Partial<SettingsPreferences> : {};
  return { compactSidebar: object.compactSidebar ?? DEFAULT_SETTINGS_PREFERENCES.compactSidebar, desktopPush: object.desktopPush ?? DEFAULT_SETTINGS_PREFERENCES.desktopPush, emailDigest: object.emailDigest ?? DEFAULT_SETTINGS_PREFERENCES.emailDigest, slackWebhook: object.slackWebhook ?? DEFAULT_SETTINGS_PREFERENCES.slackWebhook };
}
function refs(value: unknown): string[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { enabledModelRefs?: unknown }).enabledModelRefs)) return [];
  return (value as { enabledModelRefs: unknown[] }).enabledModelRefs.filter((ref): ref is string => typeof ref === "string");
}

function requiredSettingsRow<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("operator settings row is missing after ensure");
  return row;
}

export function createPostgresSettingsService(options: { pool: Pool; models: SettingsModelSource; providers?: SettingsProviderSource }) {
  async function ensure(operatorId: string): Promise<void> {
    await options.pool.query(`INSERT INTO operator_settings (operator_id) VALUES ($1) ON CONFLICT (operator_id) DO NOTHING`, [operatorId]);
  }
  return {
    async get(operatorId: string): Promise<SettingsRead> {
      await ensure(operatorId);
      const row = requiredSettingsRow((await options.pool.query<{ preferences: unknown; model_pool: unknown; spend_ceiling_cents: string; critical_actions_require_approval: boolean; allow_flashmob: boolean }>(`SELECT preferences, model_pool, spend_ceiling_cents, critical_actions_require_approval, allow_flashmob FROM operator_settings WHERE operator_id = $1`, [operatorId])).rows);
      const source = await options.models.list();
      const enabled = new Set(refs(row.model_pool));
      const models: SettingsModel[] = source.map((model) => ({ modelRef: model.modelRef, score: model.score, inUse: enabled.size === 0 ? true : enabled.has(model.modelRef) }));
      return { preferences: mergePreferences(row.preferences), authorityDefaults: { spendCeilingCents: Number(row.spend_ceiling_cents), criticalActionsRequireApproval: row.critical_actions_require_approval, allowFlashmob: row.allow_flashmob }, models, providers: options.providers === undefined ? [] : [...await options.providers.list()] };
    },
    async updatePreferences(operatorId: string, patch: SettingsPreferencesUpdate): Promise<SettingsRead> {
      await ensure(operatorId);
      const current = await this.get(operatorId);
      await options.pool.query(`UPDATE operator_settings SET preferences = $2::jsonb, updated_at = transaction_timestamp() WHERE operator_id = $1`, [operatorId, JSON.stringify({ ...current.preferences, ...patch })]);
      return this.get(operatorId);
    },
    async updateModelPool(operatorId: string, patch: SettingsModelPoolUpdate): Promise<SettingsRead> {
      await ensure(operatorId);
      const source = await options.models.list();
      if (!source.some((model) => model.modelRef === patch.modelRef)) throw new Error("model is not present in the human-owned model_map");
      const current = await this.get(operatorId);
      const enabled = new Set(current.models.filter((model) => model.inUse).map((model) => model.modelRef));
      if (patch.inUse) enabled.add(patch.modelRef); else enabled.delete(patch.modelRef);
      await options.pool.query(`UPDATE operator_settings SET model_pool = $2::jsonb, updated_at = transaction_timestamp() WHERE operator_id = $1`, [operatorId, JSON.stringify({ enabledModelRefs: [...enabled].sort() })]);
      return this.get(operatorId);
    },
    async updateAuthorityDefaults(operatorId: string, patch: SettingsAuthorityDefaultsUpdate): Promise<SettingsRead> {
      await ensure(operatorId);
      const current = await this.get(operatorId);
      const next = { ...current.authorityDefaults, ...patch };
      await options.pool.query(`UPDATE operator_settings SET spend_ceiling_cents = $2, critical_actions_require_approval = $3, allow_flashmob = $4, updated_at = transaction_timestamp() WHERE operator_id = $1`, [operatorId, next.spendCeilingCents, next.criticalActionsRequireApproval, next.allowFlashmob]);
      return this.get(operatorId);
    },
    async authorityDefaultsForOperator(operatorId: string): Promise<SettingsAuthorityDefaults> {
      await ensure(operatorId);
      const row = requiredSettingsRow((await options.pool.query<{ spend_ceiling_cents: string; critical_actions_require_approval: boolean; allow_flashmob: boolean }>(`SELECT spend_ceiling_cents, critical_actions_require_approval, allow_flashmob FROM operator_settings WHERE operator_id = $1`, [operatorId])).rows);
      return { spendCeilingCents: Number(row.spend_ceiling_cents), criticalActionsRequireApproval: row.critical_actions_require_approval, allowFlashmob: row.allow_flashmob };
    },
  };
}
