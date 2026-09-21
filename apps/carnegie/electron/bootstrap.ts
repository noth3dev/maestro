import { resolveLocalConnection, type ConnectionEnvironment, type ConnectionState, type LocalBootstrapOptions, type LocalBootstrapStepEvent } from "@maestro/local-backend";
import type { ConnectionConfig } from "./store.js";

export interface CarnegieBootstrapResult {
  config?: ConnectionConfig;
  setupError?: string;
}

export interface CarnegieBootstrapOptions {
  env: ConnectionEnvironment;
  load: () => ConnectionConfig | undefined;
  save: (config: ConnectionConfig) => void;
  resolveLocalConnection?: (options: LocalBootstrapOptions) => Promise<ConnectionState>;
  onStep?: (event: LocalBootstrapStepEvent) => void;
}

function hasConnectionEnvironmentOverride(env: ConnectionEnvironment): boolean {
  return env.MAESTRO_DISABLE_LOCAL_AUTOSTART === "true"
    || (env.MAESTRO_API_URL?.trim() ?? "") !== ""
    || (env.MAESTRO_API_TOKEN?.trim() ?? "") !== "";
}

export async function initializeCarnegieConnection(options: CarnegieBootstrapOptions): Promise<CarnegieBootstrapResult> {
  const saved = options.load();
  if (saved !== undefined) return { config: saved };
  if (hasConnectionEnvironmentOverride(options.env)) return {};

  let local: ConnectionState;
  try {
    local = await (options.resolveLocalConnection ?? resolveLocalConnection)({
      env: options.env,
      includeProjectId: true,
      ...(options.onStep === undefined ? {} : { onStep: options.onStep }),
    });
  } catch (error) {
    return { setupError: error instanceof Error ? error.message : "Local automatic setup failed" };
  }
  if (local.kind !== "configured") return { setupError: local.reason };
  if (local.projectId === undefined) return { setupError: "Local bootstrap did not return a project ID" };

  const config: ConnectionConfig = { apiUrl: local.apiUrl, token: local.token, projectId: local.projectId };
  try {
    options.save(config);
  } catch (error) {
    return { setupError: error instanceof Error ? error.message : "Could not save the local connection securely" };
  }
  return { config };
}
