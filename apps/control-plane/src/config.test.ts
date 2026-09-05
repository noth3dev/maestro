import { describe, expect, it } from "vitest";
import { parseConfig, redactConfig } from "./config.js";

const required = {
  DATABASE_URL: "postgresql://localhost/maestro",
  MAESTRO_EVIDENCE_DIR: "/tmp/maestro-evidence",
  MAESTRO_WORKTREE_ROOT: "/tmp/maestro-workspaces",
};

describe("parseConfig", () => {
  it("uses safe local defaults", () => {
    expect(parseConfig(required)).toEqual({
      databaseUrl: required.DATABASE_URL,
      evidenceDir: required.MAESTRO_EVIDENCE_DIR,
      worktreeRoot: required.MAESTRO_WORKTREE_ROOT,
      host: "127.0.0.1",
      port: 4310,
      primeAgentVersion: "0.8.0",
      actorId: "maestro-control-plane",
      leaseOwnerId: "local-control-plane",
      reconcilerLeaseDurationMs: 30_000,
      shutdownDrainTimeoutMs: 5_000,
    });
  });

  it("accepts an explicit CEO operator identity for critical-action approvals", () => {
    expect(parseConfig({ ...required, MAESTRO_CEO_OPERATOR_ID: "ceo-operator" }).ceoOperatorId).toBe("ceo-operator");
  });

  it("accepts an explicit project-access provisioning admin identity", () => {
    expect(parseConfig({ ...required, MAESTRO_OPERATOR_PROVISIONING_ADMIN_ID: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f05" }).operatorProvisioningAdminId).toBe("018f3c9b-7e71-7b44-ae23-3b5d4e8c9f05");
  });

  it("accepts an explicit startup reconciler leader-lease duration override", () => {
    expect(parseConfig({ ...required, MAESTRO_RECONCILER_LEASE_MS: "1000" }).reconcilerLeaseDurationMs).toBe(1_000);
  });

  it("rejects a non-positive reconciler leader-lease duration", () => {
    expect(() => parseConfig({ ...required, MAESTRO_RECONCILER_LEASE_MS: "0" })).toThrow("Invalid Maestro configuration");
  });

  it("fails before startup when required configuration is missing", () => {
    expect(() => parseConfig({})).toThrow("Invalid Maestro configuration");
  });

  it("rejects a non-loopback host by default", () => {
    expect(() => parseConfig({ ...required, MAESTRO_HOST: "0.0.0.0" })).toThrow(
      "Remote binding requires explicit MAESTRO_ALLOW_REMOTE=true",
    );
  });

  it("rejects a remote binding without TLS configured, even with MAESTRO_ALLOW_REMOTE=true", () => {
    expect(() => parseConfig({ ...required, MAESTRO_HOST: "0.0.0.0", MAESTRO_ALLOW_REMOTE: "true" })).toThrow(
      "Remote binding requires TLS certificate and key configuration",
    );
  });

  it.each([
    { MAESTRO_TLS_CERT_FILE: "/tmp/cert.pem" },
    { MAESTRO_TLS_KEY_FILE: "/tmp/key.pem" },
  ])("rejects a remote binding with only one half of the TLS cert/key pair configured: %j", (partial) => {
    expect(() => parseConfig({ ...required, MAESTRO_HOST: "0.0.0.0", MAESTRO_ALLOW_REMOTE: "true", ...partial })).toThrow(
      "Remote binding requires TLS certificate and key configuration",
    );
  });

  it("allows an explicit remote binding once both TLS certificate and key are configured", () => {
    const config = parseConfig({
      ...required,
      MAESTRO_HOST: "0.0.0.0",
      MAESTRO_ALLOW_REMOTE: "true",
      MAESTRO_TLS_CERT_FILE: "/tmp/cert.pem",
      MAESTRO_TLS_KEY_FILE: "/tmp/key.pem",
    });

    expect(config.host).toBe("0.0.0.0");
    expect(config.tls).toEqual({ certFile: "/tmp/cert.pem", keyFile: "/tmp/key.pem" });
  });

  it("ignores a TLS cert/key pair supplied for a loopback (non-remote) binding", () => {
    const config = parseConfig({ ...required, MAESTRO_TLS_CERT_FILE: "/tmp/cert.pem", MAESTRO_TLS_KEY_FILE: "/tmp/key.pem" });

    expect(config.host).toBe("127.0.0.1");
    expect(config.tls).toBeUndefined();
  });

  it("redacts database credentials before configuration is logged", () => {
    const config = parseConfig({
      ...required,
      DATABASE_URL: "postgresql://db-user:db-password@127.0.0.1:5432/maestro",
    });

    expect(redactConfig(config)).toEqual({
      ...config,
      databaseUrl: "postgresql://[redacted]@127.0.0.1:5432/maestro",
    });
    expect(JSON.stringify(redactConfig(config))).not.toContain("db-password");
  });

  it("excludes provider-credential-shaped env vars from the accepted output (Phase 1 re-patch item 7)", () => {
    const providerCredentialMetronomes = {
      OPENAI_API_KEY: "sk-test-openai-should-never-appear",
      ANTHROPIC_API_KEY: "sk-ant-test-should-never-appear",
      OPENROUTER_API_KEY: "sk-or-test-should-never-appear",
    };

    const withoutCredentials = parseConfig(required);
    const withCredentials = parseConfig({ ...required, ...providerCredentialMetronomes });

    // parseConfig's zod schema only ever destructures its own known keys, so
    // an unrelated provider-credential env var present in process.env must
    // never leak into the returned config, regardless of its value.
    expect(withCredentials).toEqual(withoutCredentials);
    expect(Object.keys(withCredentials).sort()).toEqual([
      "actorId", "databaseUrl", "evidenceDir", "host", "leaseOwnerId", "port", "primeAgentVersion", "reconcilerLeaseDurationMs", "shutdownDrainTimeoutMs", "worktreeRoot",
    ]);
    const serialized = JSON.stringify(withCredentials);
    for (const secret of Object.values(providerCredentialMetronomes)) {
      expect(serialized).not.toContain(secret);
    }
  });
});
