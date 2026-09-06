export type ConnectionState =
  | { kind: "configured"; apiUrl: string; token: string }
  | { kind: "setup-required"; reason: string };

export interface ConnectionEnvironment {
  MAESTRO_API_URL?: string;
  MAESTRO_API_TOKEN?: string;
}

export async function resolveConnection(env: ConnectionEnvironment): Promise<ConnectionState> {
  const apiUrl = env.MAESTRO_API_URL?.trim();
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
