import type { ApiClient, BillingReadModel, GoalBudgetSummary } from "@maestro/api-client";
import type {
  ProviderCredentialBinding,
  ProviderCredentialLoginInput,
  SettingsAuthorityDefaults,
  SettingsAuthorityDefaultsUpdate,
  SettingsModelPoolUpdate,
  SettingsPreferencesUpdate,
  SettingsRead,
} from "@maestro/contracts";

/** The renderer only receives durable settings and write results from these routes. */
export type SettingsApi = Pick<
  ApiClient,
  | "getSettings"
  | "updateSettingsPreferences"
  | "updateSettingsModelPool"
  | "updateSettingsAuthorityDefaults"
  | "listModels"
  | "listProviderConnections"
  | "loginProvider"
  | "logoutProvider"
  | "getBudgetSummary"
  | "getBillingSummary"
>;

/**
 * A tiny server-authoritative settings store. It deliberately has no optimistic
 * state: a write becomes visible only after the server returns the replacement
 * SettingsRead. Failed writes leave the last saved value untouched.
 */
export function createSettingsStore(api: SettingsApi) {
  let saved: SettingsRead | undefined;

  const replace = (next: SettingsRead): SettingsRead => {
    saved = next;
    return next;
  };

  return {
    getSaved: (): SettingsRead | undefined => saved,
    load: async (): Promise<SettingsRead> => replace(await api.getSettings()),
    updatePreferences: async (patch: SettingsPreferencesUpdate): Promise<SettingsRead> =>
      replace(await api.updateSettingsPreferences(patch)),
    updateModelPool: async (patch: SettingsModelPoolUpdate): Promise<SettingsRead> =>
      replace(await api.updateSettingsModelPool(patch)),
    updateAuthorityDefaults: async (patch: SettingsAuthorityDefaultsUpdate): Promise<SettingsRead> =>
      replace(await api.updateSettingsAuthorityDefaults(patch)),
    loginProvider: (input: ProviderCredentialLoginInput): Promise<ProviderCredentialBinding> => api.loginProvider(input),
    logoutProvider: (providerId: "openai" | "anthropic"): Promise<void> => api.logoutProvider(providerId),
    listModels: () => api.listModels(),
    listProviderConnections: () => api.listProviderConnections(),
    getBudgetSummary: (goalId: string, query: Parameters<ApiClient["getBudgetSummary"]>[1]): Promise<GoalBudgetSummary> =>
      api.getBudgetSummary(goalId, query),
    getBillingSummary: (projectId: string): Promise<BillingReadModel> => api.getBillingSummary(projectId),
  };
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function raisesAuthority(
  current: SettingsAuthorityDefaults,
  patch: SettingsAuthorityDefaultsUpdate,
): boolean {
  return (patch.spendCeilingCents !== undefined && patch.spendCeilingCents > current.spendCeilingCents) ||
    (patch.criticalActionsRequireApproval === false && current.criticalActionsRequireApproval) ||
    (patch.allowFlashmob === true && !current.allowFlashmob);
}

export function hasAvailableModel(settings: Pick<SettingsRead, "models"> | undefined): boolean {
  return settings?.models.some((model) => model.inUse) ?? false;
}

export function readError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== "" ? error.message : fallback;
}

export function redactSecret(message: string, secret: string): string {
  return secret.trim() === "" ? message : message.split(secret).join("[redacted]");
}

export function safeErrorMessage(error: unknown, fallback: string): string {
  const message = readError(error, fallback);
  return message
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/((?:api[-_ ]?key|token|secret)\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]");
}
