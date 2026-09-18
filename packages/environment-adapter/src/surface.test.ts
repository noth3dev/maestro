import { describe, expect, it } from "vitest";

describe("environment-adapter surface", () => {
  it("pins the barrel export list", async () => {
    const surface = await import("./index.js");
    expect(Object.keys(surface).sort()).toMatchInlineSnapshot(`
      [
        "EnvironmentAuthorizationError",
        "EnvironmentBoundaryError",
        "EnvironmentExecutionError",
        "EnvironmentOutcomeUnknownError",
        "FileEditAuthorizationError",
        "FileEditBoundaryError",
        "FileEditOutcomeUnknownError",
        "ReadOnlyFileAuthorizationError",
        "ReadOnlyFileBoundaryError",
        "createAuthorizedFileEditPort",
        "createAuthorizedReadOnlyFilePort",
        "createBrowserEnvironmentAdapter",
        "createContainerSandboxAdapter",
        "createLocalRuntimeAdapter",
      ]
    `);
  });
});
