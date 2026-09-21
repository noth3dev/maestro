import { describe, expect, it } from "vitest";
import { persistConnectionConfig, restoreConnectionConfig, type ConnectionSecretStore } from "./connection-storage.js";

const config = { apiUrl: "http://127.0.0.1:4310", token: "credential.secret", projectId: "11111111-1111-4111-8111-111111111111" };

function secretStore(initial?: string): ConnectionSecretStore {
  let value = initial;
  return {
    read: () => value,
    write: (next) => { value = next; },
  };
}

describe("Carnegie connection secret storage", () => {
  it("uses Electron encryption when it is available", () => {
    const secrets = secretStore();
    const stored = persistConnectionConfig(config, {
      isAvailable: () => true,
      encrypt: (value) => `encrypted:${value}`,
      decrypt: (value) => value.replace("encrypted:", ""),
    }, secrets);

    expect(stored).toEqual({ apiUrl: config.apiUrl, projectId: config.projectId, tokenEncryptedBase64: "encrypted:credential.secret" });
    expect(secrets.read()).toBeUndefined();
    expect(restoreConnectionConfig(stored, {
      isAvailable: () => true,
      encrypt: (value) => value,
      decrypt: (value) => value.replace("encrypted:", ""),
    }, secrets)).toEqual(config);
  });

  it("uses the protected keyring when Electron encryption is unavailable", () => {
    const secrets = secretStore();
    const stored = persistConnectionConfig(config, {
      isAvailable: () => false,
      encrypt: (value) => value,
      decrypt: (value) => value,
    }, secrets);

    expect(stored).toEqual({ apiUrl: config.apiUrl, projectId: config.projectId });
    expect(secrets.read()).toBe(config.token);
    expect(restoreConnectionConfig(stored, {
      isAvailable: () => false,
      encrypt: (value) => value,
      decrypt: (value) => value,
    }, secrets)).toEqual(config);
  });

  it("falls back to the keyring when an encrypted record cannot be decrypted", () => {
    const secrets = secretStore(config.token);
    expect(restoreConnectionConfig({ apiUrl: config.apiUrl, projectId: config.projectId, tokenEncryptedBase64: "stale" }, {
      isAvailable: () => true,
      encrypt: (value) => value,
      decrypt: () => { throw new Error("safe storage unavailable"); },
    }, secrets)).toEqual(config);
  });

  it("fails closed when neither protected storage contains a token", () => {
    expect(() => restoreConnectionConfig({ apiUrl: config.apiUrl, projectId: config.projectId }, {
      isAvailable: () => false,
      encrypt: (value) => value,
      decrypt: (value) => value,
    }, secretStore())).toThrow("Stored control-plane token is unavailable");
  });
});
