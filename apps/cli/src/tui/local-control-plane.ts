export type LocalControlPlaneState =
  | { kind: "ready"; apiUrl: string }
  | { kind: "unavailable"; apiUrl: string; reason: string };

export interface LocalControlPlaneOptions {
  apiUrl: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export async function ensureLocalControlPlane(options: LocalControlPlaneOptions): Promise<LocalControlPlaneState> {
  const fetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 3_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) return { kind: "unavailable", apiUrl: options.apiUrl, reason: "Control Plane health check timeout is invalid" };
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = fetch(`${options.apiUrl.replace(/\/$/, "")}/healthz`, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    request.catch(() => undefined);
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => { timedOut = true; controller.abort(); resolve(undefined); }, timeoutMs);
    });
    const response = await Promise.race([request, timeout]);
    if (timedOut || response === undefined) return { kind: "unavailable", apiUrl: options.apiUrl, reason: "Control Plane health check timed out" };
    if (!response.ok) return { kind: "unavailable", apiUrl: options.apiUrl, reason: "Control Plane is not reachable" };
    return { kind: "ready", apiUrl: options.apiUrl };
  } catch {
    return { kind: "unavailable", apiUrl: options.apiUrl, reason: timedOut ? "Control Plane health check timed out" : "Control Plane is not reachable" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
