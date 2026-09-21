export interface ConnectionConfig {
  apiUrl: string;
  token: string;
  projectId: string;
}

export interface StoredConnectionConfig {
  apiUrl: string;
  projectId: string;
  tokenEncryptedBase64?: string;
}

export interface ConnectionSecretStore {
  read(): string | undefined;
  write(value: string): void;
}

export interface ConnectionEncryption {
  isAvailable(): boolean;
  encrypt(value: string): string;
  decrypt(value: string): string;
}

export function persistConnectionConfig(
  config: ConnectionConfig,
  encryption: ConnectionEncryption,
  secrets: ConnectionSecretStore,
): StoredConnectionConfig {
  if (encryption.isAvailable()) {
    return {
      apiUrl: config.apiUrl,
      projectId: config.projectId,
      tokenEncryptedBase64: encryption.encrypt(config.token),
    };
  }
  secrets.write(config.token);
  return { apiUrl: config.apiUrl, projectId: config.projectId };
}

export function restoreConnectionConfig(
  stored: StoredConnectionConfig,
  encryption: ConnectionEncryption,
  secrets: ConnectionSecretStore,
): ConnectionConfig {
  if (stored.tokenEncryptedBase64 !== undefined && encryption.isAvailable()) {
    try {
      return {
        apiUrl: stored.apiUrl,
        projectId: stored.projectId,
        token: encryption.decrypt(stored.tokenEncryptedBase64),
      };
    } catch {
      // A basic/OS keychain transition can invalidate Electron's ciphertext.
      // Try the protected keyring before failing closed.
    }
  }
  const token = secrets.read();
  if (token === undefined || token.trim() === "") throw new Error("Stored control-plane token is unavailable");
  return { apiUrl: stored.apiUrl, projectId: stored.projectId, token };
}
