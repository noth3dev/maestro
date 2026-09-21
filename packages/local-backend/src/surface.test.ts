import { describe, expect, it } from "vitest";

describe("local-backend surface", () => {
  it("pins the barrel export list", async () => {
    const surface = await import("./index.js");
    expect(Object.keys(surface).sort()).toMatchInlineSnapshot(`
      [
        "DEFAULT_LOCAL_API_URL",
        "DEFAULT_LOCAL_DATABASE_URL",
        "DOCKER_LOCAL_DATABASE_URL",
        "LOCAL_BOOTSTRAP_STEP_ORDER",
        "LOCAL_POSTGRES_CONTAINER",
        "buildLocalControlPlaneEnvironment",
        "buildLocalModelGatewayEnvironment",
        "configuredEmbeddedDatabasePort",
        "ensureLocalControlPlane",
        "resolveConnection",
        "resolveInstalledControlPlaneEntry",
        "resolveLocalConnection",
        "resolvePackagedAppEntry",
      ]
    `);
  });
});
