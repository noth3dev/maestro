import { describe, expect, it } from "vitest";
import { parseSecretaryConfig, publicGoalConfig } from "./config.js";

const valid = {
  MAESTRO_SECRETARY_API_URL: "http://127.0.0.1:4310",
  MAESTRO_SECRETARY_API_TOKEN: "local-secret",
  MAESTRO_SECRETARY_PROJECT_ID: "11111111-1111-4111-8111-111111111111",
  MAESTRO_SECRETARY_GOAL_ID: "22222222-2222-4222-8222-222222222222",
};

describe("Secretary server configuration", () => {
  it("accepts only a loopback control-plane URL and does not serialize the bearer token", () => {
    const config = parseSecretaryConfig(valid);
    expect(config).toMatchObject({ apiUrl: "http://127.0.0.1:4310", projectId: valid.MAESTRO_SECRETARY_PROJECT_ID, goalId: valid.MAESTRO_SECRETARY_GOAL_ID });
    expect(JSON.stringify(publicGoalConfig(config))).not.toContain(valid.MAESTRO_SECRETARY_API_TOKEN);
  });

  it("rejects remote control-plane URLs", () => {
    expect(() => parseSecretaryConfig({ ...valid, MAESTRO_SECRETARY_API_URL: "https://control.example" })).toThrow("loopback");
  });
});
