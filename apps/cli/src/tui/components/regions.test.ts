import { describe, expect, it } from "vitest";
import { createSplashController, type TuiShellState } from "./shell.js";
import { createStatusRegion } from "./regions.js";

const state: TuiShellState = {
  workspace: { cwd: "/work/acme", gitRoot: "/work/acme" },
  connection: { kind: "connecting" },
  goal: { kind: "loading" },
  workers: { kind: "loading" },
  approvals: { kind: "loading" },
  budget: { kind: "loading" },
};

describe("TUI startup regions", () => {
  it("does not consume the splash while dashboard state is still loading", () => {
    const splash = createSplashController();
    const region = createStatusRegion({
      state: {
        ...state,
        connection: { kind: "connected" },
        organization: { kind: "value", value: { departments: ["Product Department"] } },
      },
      height: () => 30,
      splash,
    });

    region.render(120);
    expect(splash.visible()).toBe(true);
  });

  it("keeps the splash controller owned during the initial connecting frame", () => {
    const splash = createSplashController();
    const region = createStatusRegion({ state, height: () => 30, splash });
    const output = region.render(120).join("\n");

    expect(output).toContain("Docker check");
    expect(output).toContain("Model gateway");
    expect(splash.visible()).toBe(true);
  });
});
