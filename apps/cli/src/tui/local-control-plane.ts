export type LocalControlPlaneState =
  | { kind: "ready"; apiUrl: string }
  | { kind: "unavailable"; apiUrl: string; reason: string };

export interface LocalControlPlaneOptions {
  apiUrl: string;
  fetch?: typeof globalThis.fetch;
}

export async function ensureLocalControlPlane(options: LocalControlPlaneOptions): Promise<LocalControlPlaneState> {
  const fetch = options.fetch ?? globalThis.fetch;
  try {
    const response = await fetch(`${options.apiUrl.replace(/\/$/, "")}/healthz`, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return { kind: "unavailable", apiUrl: options.apiUrl, reason: "Control Plane is not reachable" };
    return { kind: "ready", apiUrl: options.apiUrl };
  } catch {
    return { kind: "unavailable", apiUrl: options.apiUrl, reason: "Control Plane is not reachable" };
  }
}
