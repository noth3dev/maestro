import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { app, safeStorage } from "electron";

export interface ConnectionConfig {
  apiUrl: string;
  token: string;
  projectId: string;
}

export type PublicConnectionConfig = Omit<ConnectionConfig, "token">;

interface StoredConfig {
  apiUrl: string;
  projectId: string;
  tokenEncryptedBase64: string;
}

function configPath(): string {
  return join(app.getPath("userData"), "connection.json");
}

function assertLoopback(apiUrl: string): void {
  const url = new URL(apiUrl);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "::1") {
    throw new Error("Control plane URL must be a loopback host");
  }
}

export function loadConnectionConfig(): ConnectionConfig | undefined {
  const path = configPath();
  if (!existsSync(path)) return undefined;
  const stored = JSON.parse(readFileSync(path, "utf8")) as StoredConfig;
  const token = safeStorage.decryptString(Buffer.from(stored.tokenEncryptedBase64, "base64"));
  return { apiUrl: stored.apiUrl, projectId: stored.projectId, token };
}

export function saveConnectionConfig(config: ConnectionConfig): PublicConnectionConfig {
  assertLoopback(config.apiUrl);
  if (!safeStorage.isEncryptionAvailable()) {
    // ponytail: no plaintext fallback — an OS without a secret store fails closed rather than risking the bearer token on disk unencrypted.
    throw new Error("OS-level secret storage is unavailable on this machine; cannot save the control-plane token securely");
  }
  const stored: StoredConfig = {
    apiUrl: config.apiUrl,
    projectId: config.projectId,
    tokenEncryptedBase64: safeStorage.encryptString(config.token).toString("base64"),
  };
  writeFileSync(configPath(), JSON.stringify(stored), { mode: 0o600 });
  return { apiUrl: config.apiUrl, projectId: config.projectId };
}

export function clearConnectionConfig(): void {
  const path = configPath();
  if (existsSync(path)) unlinkSync(path);
}
