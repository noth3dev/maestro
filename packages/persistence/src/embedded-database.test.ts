import { describe, expect, it } from "vitest";
import { buildEmbeddedDatabaseChildEnvironment } from "./embedded-database.js";

describe("embedded database child environment", () => {
  it("removes an inherited port when startup did not validate one", () => {
    const environment = buildEmbeddedDatabaseChildEnvironment(
      { dataDir: "/tmp/maestro-test", detached: true },
      { MAESTRO_EMBEDDED_DATABASE_PORT: "abc", PATH: "/usr/bin" },
    );
    expect(environment).not.toHaveProperty("MAESTRO_EMBEDDED_DATABASE_PORT");
    expect(environment.PATH).toBe("/usr/bin");
  });

  it("uses the explicit validated port when one is supplied", () => {
    const environment = buildEmbeddedDatabaseChildEnvironment(
      { dataDir: "/tmp/maestro-test", detached: true, port: 55_434 },
      { MAESTRO_EMBEDDED_DATABASE_PORT: "abc", PATH: "/usr/bin" },
    );
    expect(environment.MAESTRO_EMBEDDED_DATABASE_PORT).toBe("55434");
  });

  it("runs the detached database as Node when composed inside Electron", () => {
    const environment = buildEmbeddedDatabaseChildEnvironment(
      { dataDir: "/tmp/maestro-test", detached: true },
      { PATH: "/usr/bin" },
      "33.4.11",
    );
    expect(environment.ELECTRON_RUN_AS_NODE).toBe("1");
  });
});
