import { describe, expect, it } from "vitest";

describe("model-gateway surface", () => {
  it("pins the barrel export list", async () => {
    const surface = await import("./index.js");
    expect(Object.keys(surface).sort()).toMatchInlineSnapshot(`
      [
        "InMemoryCredentialStore",
        "KeychainCredentialStore",
        "ManagedCredentialWithoutSecretError",
        "ModelGateway",
        "buildModelGatewayServer",
        "createGatewayFromEnv",
        "createModelGateway",
        "startModelGateway",
      ]
    `);
  });
});
