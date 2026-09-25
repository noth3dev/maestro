import { ApiError } from "@maestro/api-client";
import type { MaestroBridge } from "./global.js";

type SerializedBridgeError =
  | { readonly kind: "api-error"; readonly status: number; readonly code: string; readonly message: string; readonly detail?: string }
  | { readonly kind: "error"; readonly message: string };

function isEnvelope(value: unknown): value is { ok: true; value: unknown } | { ok: false; error: SerializedBridgeError } {
  return typeof value === "object" && value !== null && "ok" in value && typeof (value as { ok?: unknown }).ok === "boolean";
}

export function unwrapBridgeResponse(response: unknown): unknown {
  if (!isEnvelope(response)) return response;
  if (response.ok) return response.value;
  const { error } = response;
  if (error.kind === "api-error") {
    throw new ApiError(error.status, error.code as ApiError["code"], error.message, error.detail);
  }
  throw new Error(error.message);
}

/**
 * contextBridge only preserves an Error's message, so the preload exposes
 * `maestroBridge` whose API calls resolve with the main-process envelope.
 * Rebuild `window.maestro` here so renderer code can rely on `status`/`code`.
 */
export function installMaestroBridge(target: { maestroBridge?: MaestroBridge; maestro?: MaestroBridge }): void {
  const raw = target.maestroBridge;
  if (raw === undefined) return;
  const api = Object.fromEntries(
    Object.entries(raw.api as unknown as Record<string, (...args: unknown[]) => unknown>).map(([method, call]) => [
      method,
      async (...args: unknown[]) => unwrapBridgeResponse(await call(...args)),
    ]),
  ) as unknown as MaestroBridge["api"];
  target.maestro = { ...raw, api };
}
