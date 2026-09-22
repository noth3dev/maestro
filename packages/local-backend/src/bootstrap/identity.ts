import { createHash } from "node:crypto";
import { DEFAULT_LOCAL_API_URL } from "./constants.js";

export function extractLocalSecret(token: string | undefined): string | undefined {
  if (token === undefined) return undefined;
  const separator = token.indexOf(".");
  if (separator <= 0 || separator === token.length - 1) return undefined;
  return token.slice(separator + 1);
}

export function extractUuidCredentialId(token: string | undefined): string | undefined {
  if (token === undefined) return undefined;
  const credentialId = token.slice(0, token.indexOf("."));
  return isCanonicalUuid(credentialId) ? credentialId : undefined;
}

export function isCanonicalUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

export function deriveModelGatewayToken(secret: string): string {
  return createHash("sha256").update(`maestro-model-gateway\0${secret}`, "utf8").digest("base64url");
}

export function normalizeModelGatewayUrl(value: string | undefined): string {
  const candidate = value?.trim() || "http://127.0.0.1:4321";
  let url: URL;
  try { url = new URL(candidate); } catch { throw new Error("MAESTRO_MODEL_GATEWAY_URL is not a valid URL"); }
  if (url.protocol !== "http:") throw new Error("Local model gateway auto-start requires loopback HTTP");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Local model gateway auto-start requires a loopback host");
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") throw new Error("MAESTRO_MODEL_GATEWAY_URL must not include a path or query");
  return url.toString().replace(/\/$/, "");
}

export function normalizeApiUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? DEFAULT_LOCAL_API_URL : trimmed.replace(/\/$/, "");
}
