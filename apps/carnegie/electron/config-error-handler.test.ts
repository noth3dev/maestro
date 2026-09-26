import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createConfigErrorHandler, withSanitizedConfigError } from "./config-error-handler.js";

describe("config error IPC handler", () => {
  it("returns a bounded recovery summary instead of an oversized diagnostic", () => {
    const diagnostic = `PGlite database mutex failure: ${"x".repeat(65_598)}`;
    const handler = createConfigErrorHandler(() => diagnostic);

    const result = handler();
    expect(result).toBe("The local database may be busy or locked. Close other Maestro instances, then retry local setup.");
    expect(result).not.toContain("x".repeat(128));
  });

  it("returns undefined when no setup error is available", () => {
    expect(createConfigErrorHandler(() => undefined)()).toBeUndefined();
  });

  it("bounds config storage failures before the IPC promise rejects", async () => {
    const diagnostic = `Unable to open local config: ${"x".repeat(65_598)}`;
    const operation = withSanitizedConfigError(() => Promise.reject(new Error(diagnostic)), "Could not load the saved connection");

    await expect(operation).rejects.toThrow("Local setup failed. The diagnostic is too long to display");
    await expect(operation).rejects.not.toThrow("x".repeat(128));
  });

  it("routes config IPC channels through the bounded error handler", () => {
    const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const handlers = [
      ["maestro:config:get", "withSanitizedConfigError"],
      ["maestro:config:error", "createConfigErrorHandler"],
      ["maestro:config:save", "withSanitizedConfigError"],
      ["maestro:config:clear", "withSanitizedConfigError"],
    ] as const;

    for (const [channel, wrapper] of handlers) {
      const channelIndex = main.indexOf(`"${channel}"`);
      const start = main.lastIndexOf("ipcMain.handle(", channelIndex);
      const end = main.indexOf("\n  ipcMain.", channelIndex);
      expect(channelIndex, `${channel} handler exists`).toBeGreaterThanOrEqual(0);
      expect(main.slice(start, end === -1 ? undefined : end), `${channel} uses ${wrapper}`).toContain(wrapper);
    }
  });
});
