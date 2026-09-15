import type { ConnectionEnvironment, ConnectionState } from "../../cli/dist/tui/connection.js";
import type { ConnectionConfig } from "./store.js";

export interface CarnegieBootstrapResult {
  config?: ConnectionConfig;
  setupError?: string;
}

export interface CarnegieBootstrapOptions {
  env: ConnectionEnvironment;
  load: () => ConnectionConfig | undefined;
  save: (config: ConnectionConfig) => void;
  resolveLocalConnection: (options: { env: ConnectionEnvironment }) => Promise<ConnectionState>;
}

export async function initializeCarnegieConnection(_options: CarnegieBootstrapOptions): Promise<CarnegieBootstrapResult> {
  return {};
}
