import { describe, expect, it } from "vitest";
import { createSplashController, type SetupStep, type TuiShellState } from "./shell.js";
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

  it("consumes the splash after an organization error settles hydration", () => {
    const splash = createSplashController();
    const region = createStatusRegion({
      state: {
        ...state,
        connection: { kind: "connected" },
        goal: { kind: "value", value: { goalId: "goal-1", name: "goal-1", state: "running" } },
        workers: { kind: "value", value: 0 },
        budget: { kind: "value", value: { spentCents: 0, ceilingCents: 500 } },
        organization: { kind: "error", message: "gateway unavailable" },
      },
      height: () => 24,
      splash,
    });

    const first = region.render(80).join("\n");
    expect(first).toContain("ctrl+/ show home");
    expect(splash.visible()).toBe(false);
    const second = region.render(80).join("\n");
    expect(second).not.toContain("ctrl+/ show home");
  });

  it("preserves the splash through a compact frame until it can render", () => {
    const splash = createSplashController();
    let height = 15;
    const region = createStatusRegion({
      state: {
        ...state,
        connection: { kind: "connected" },
        goal: { kind: "value", value: { goalId: "goal-1", name: "goal-1", state: "running" } },
        workers: { kind: "value", value: 0 },
        budget: { kind: "value", value: { spentCents: 0, ceilingCents: 500 } },
        organization: { kind: "value", value: { departments: ["Product Department"] } },
      },
      height: () => height,
      splash,
    });

    expect(region.render(80).join("\n")).not.toContain("ctrl+/ show home");
    expect(splash.visible()).toBe(true);

    height = 24;
    expect(region.render(80).join("\n")).toContain("ctrl+/ show home");
    expect(splash.visible()).toBe(false);
    expect(region.render(80).join("\n")).not.toContain("ctrl+/ show home");
  });

  it("keeps the splash controller owned during the initial connecting frame", () => {
    const splash = createSplashController();
    const setupSteps: SetupStep[] = [
      { step: "docker-check", status: "started" },
      { step: "postgres-ready", status: "pending" },
      { step: "migrations", status: "pending" },
      { step: "control-plane-up", status: "pending" },
      { step: "model-gateway-up", status: "pending" },
    ];
    const region = createStatusRegion({ state: { ...state, setupSteps }, height: () => 30, splash });
    const output = region.render(120).join("\n");

    expect(output).toContain("Docker check");
    expect(output).toContain("Model gateway");
    expect(splash.visible()).toBe(true);
  });
});
