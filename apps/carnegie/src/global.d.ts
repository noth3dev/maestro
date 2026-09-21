import type { ApiClient, EventQuery } from "@maestro/api-client";
import type { EventStreamMessage } from "../electron/event-stream-bridge.js";
import type { ExposedApiMethod } from "../electron/apiBridge.js";
import type { LocalePreference, ThemePreference } from "../electron/preferences.js";

export type BridgedApi = Pick<ApiClient, Exclude<ExposedApiMethod, "streamEvents">>;

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
    error(): Promise<string | undefined>;
    save(config: ConnectionInput): Promise<PublicConnectionConfig>;
    clear(): Promise<void>;
  };
  preferences: {
    get(): Promise<Preferences>;
    save(preferences: Preferences): Promise<void>;
  };
  windowControls: {
    minimize(): void;
    toggleMaximize(): Promise<boolean>;
    isMaximized(): Promise<boolean>;
    close(): void;
    onStateChange(listener: (maximized: boolean) => void): () => void;
  };
  events: {
    subscribe(query: EventQuery, listener: (message: EventStreamMessage) => void): () => void;
  };
}

declare global {
  interface Window {
    maestro: MaestroBridge;
  }
}
