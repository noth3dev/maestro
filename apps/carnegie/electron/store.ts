import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { app, safeStorage } from "electron";
import { createLocalSecretStore } from "@maestro/local-backend";
import { persistConnectionConfig, restoreConnectionConfig, type ConnectionConfig, type StoredConnectionConfig } from "./connection-storage.js";

export type { ConnectionConfig } from "./connection-storage.js";

export type PublicConnectionConfig = Omit<ConnectionConfig, "token">;

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
  const stored = JSON.parse(readFileSync(path, "utf8")) as StoredConnectionConfig;
  return restoreConnectionConfig(stored, {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value) => safeStorage.encryptString(value).toString("base64"),
    decrypt: (value) => safeStorage.decryptString(Buffer.from(value, "base64")),
  }, createLocalSecretStore());
}

export function saveConnectionConfig(config: ConnectionConfig): PublicConnectionConfig {
  assertLoopback(config.apiUrl);
  const stored = persistConnectionConfig(config, {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value) => safeStorage.encryptString(value).toString("base64"),
    decrypt: (value) => safeStorage.decryptString(Buffer.from(value, "base64")),
  }, createLocalSecretStore());
  writeFileSync(configPath(), JSON.stringify(stored), { mode: 0o600 });
  return { apiUrl: config.apiUrl, projectId: config.projectId };
}

export function clearConnectionConfig(): void {
  const path = configPath();
  if (existsSync(path)) unlinkSync(path);
}
