export type ConnectionState =
  | { kind: "configured"; apiUrl: string; token: string }
  | { kind: "setup-required"; reason: string };

export interface ConnectionEnvironment {
  MAESTRO_API_URL?: string;
  MAESTRO_API_TOKEN?: string;
  MAESTRO_CONTROL_PLANE_ENTRY?: string;
  MAESTRO_LOCAL_DATABASE_URL?: string;
  MAESTRO_LOCAL_DATA_DIR?: string;
  MAESTRO_LOCAL_OPERATOR_ID?: string;
  MAESTRO_MODEL_GATEWAY_URL?: string;
  MAESTRO_MODEL_GATEWAY_TOKEN?: string;
  MAESTRO_MODEL_GATEWAY_OPERATOR_ID?: string;
  MAESTRO_MODEL_GATEWAY_ENTRY?: string;
  MAESTRO_CODEX_APP_SERVER_COMMAND?: string;
  MAESTRO_CODEX_MODELS?: string;
  MAESTRO_DISABLE_LOCAL_AUTOSTART?: string;
}

export async function resolveConnection(env: ConnectionEnvironment): Promise<ConnectionState> {
  const apiUrl = env.MAESTRO_API_URL?.trim() || (env.MAESTRO_API_TOKEN?.trim() ? "http://127.0.0.1:4310" : undefined);
  const token = env.MAESTRO_API_TOKEN?.trim();
  if (apiUrl !== undefined && apiUrl !== "" && token !== undefined && token !== "") {
    try {
      const parsed = new URL(apiUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("unsupported protocol");
      return { kind: "configured", apiUrl: parsed.toString().replace(/\/$/, ""), token };
    } catch {
      return { kind: "setup-required", reason: "MAESTRO_API_URL is not a valid HTTP(S) URL" };
    }
  }
  return { kind: "setup-required", reason: "Control Plane connection is not configured" };
}
