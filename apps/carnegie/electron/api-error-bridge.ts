import { ApiError } from "@maestro/api-client";

export type SerializedBridgeError =
  | { readonly kind: "api-error"; readonly status: number; readonly code: string; readonly message: string; readonly detail?: string }
  | { readonly kind: "error"; readonly message: string };

export type ApiBridgeResponse<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SerializedBridgeError };

export function redactBridgeText(value: string): string {
  return value
    .replace(/((?:["']?(?:authorization|token|access[_ -]?token|refresh[_ -]?token|id[_ -]?token|api[-_ ]?key|client[_ -]?secret|secret|password|credential)["']?)\s*[:=]\s*)(["']?)(?:Bearer\s+)?[^\s,;}"']+(["']?)/gi, "$1$2[redacted]$3")
    .replace(/\bBearer\s+[^\s,;}"']+/gi, "Bearer [redacted]");
}

export function serializeBridgeError(error: unknown): SerializedBridgeError {
  if (error instanceof ApiError) {
    const base = {
      kind: "api-error" as const,
      status: error.status,
      code: error.code,
      message: redactBridgeText(error.message),
    };
    return error.detail === undefined ? base : { ...base, detail: redactBridgeText(error.detail) };
  }
  return { kind: "error", message: redactBridgeText(error instanceof Error ? error.message : "Unexpected error") };
}

export async function invokeWithErrorEnvelope<T>(action: () => T | Promise<T>): Promise<ApiBridgeResponse<T>> {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    return { ok: false, error: serializeBridgeError(error) };
  }
}

export function restoreBridgeError(error: SerializedBridgeError): Error {
  const restored = new Error(error.message);
  if (error.kind === "api-error") {
    Object.assign(restored, { name: "ApiError", status: error.status, code: error.code, ...(error.detail === undefined ? {} : { detail: error.detail }) });
  }
  return restored;
}
