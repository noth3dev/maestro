import type { ApiClient } from "@maestro/api-client";
import type { ExposedApiMethod } from "../electron/apiBridge.js";
import type { LocalePreference, ThemePreference } from "../electron/preferences.js";

export type BridgedApi = Pick<ApiClient, ExposedApiMethod>;

export interface PublicConnectionConfig {
  apiUrl: string;
  projectId: string;
}

export interface ConnectionInput extends PublicConnectionConfig {
  token: string;
}

export interface Preferences {
  theme: ThemePreference;
  locale: LocalePreference;
}

export interface MaestroBridge {
  api: BridgedApi;
  config: {
    get(): Promise<PublicConnectionConfig | undefined>;
    save(config: ConnectionInput): Promise<PublicConnectionConfig>;
    clear(): Promise<void>;
  };
  preferences: {
    get(): Promise<Preferences>;
    save(preferences: Preferences): Promise<void>;
  };
}

declare global {
  interface Window {
    maestro: MaestroBridge;
  }
}
