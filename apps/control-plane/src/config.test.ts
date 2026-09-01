import { describe, expect, it } from "vitest";
import { parseConfig, redactConfig } from "./config.js";

const required = {
  DATABASE_URL: "postgresql://localhost/maestro",
  MAESTRO_EVIDENCE_DIR: "/tmp/maestro-evidence",
};

describe("parseConfig", () => {
  it("uses safe local defaults", () => {
    expect(parseConfig(required)).toEqual({
      databaseUrl: required.DATABASE_URL,
      evidenceDir: required.MAESTRO_EVIDENCE_DIR,
      host: "127.0.0.1",
      port: 4310,
      primeAgentVersion: "0.8.0",
      actorId: "maestro-control-plane",
      leaseOwnerId: "local-control-plane",
    });
  });

  it("fails before startup when required configuration is missing", () => {
    expect(() => parseConfig({})).toThrow("Invalid Maestro configuration");
  });

  it("rejects a non-loopback host by default", () => {
    expect(() => parseConfig({ ...required, MAESTRO_HOST: "0.0.0.0" })).toThrow(
      "Remote binding requires explicit MAESTRO_ALLOW_REMOTE=true",
    );
  });

  it("allows an explicit remote binding", () => {
    expect(parseConfig({ ...required, MAESTRO_HOST: "0.0.0.0", MAESTRO_ALLOW_REMOTE: "true" }).host).toBe("0.0.0.0");
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
});
