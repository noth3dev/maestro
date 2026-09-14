import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Carnegie settings IPC surface", () => {
  it("keeps renderer and preload allow-lists wired for settings operations", () => {
    const apiBridge = readFileSync(resolve(process.cwd(), "apps/carnegie/electron/apiBridge.ts"), "utf8");
    const preload = readFileSync(resolve(process.cwd(), "apps/carnegie/electron/preload.cts"), "utf8");
    for (const method of ["getSettings", "updateSettingsPreferences", "updateSettingsModelPool", "updateSettingsAuthorityDefaults", "listProviderConnections", "loginProvider", "logoutProvider"]) {
      expect(apiBridge).toContain(`"${method}"`);
      expect(preload).toContain(`"${method}"`);
    }
  });
});
