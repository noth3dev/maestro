import { describe, expect, it } from "vitest";
import { renderSetupSteps, renderShell, renderStatusHeader, renderTuiFooter, renderTuiLayout, type SetupStep, type TuiShellState } from "./shell.js";

const state: TuiShellState = {
  workspace: { cwd: "/work/acme", gitRoot: "/work/acme" },
  connection: { kind: "connected" },
  goal: { kind: "empty" },
  workers: { kind: "empty" },
  approvals: { kind: "empty" },
  budget: { kind: "empty" },
};

describe("Maestro TUI shell", () => {
  it("uses Maestro branding only on the first splash frame", () => {
    const output = renderShell(state, 120, 30, { showSplash: true }).join("\n");
    expect(output).toContain("MAESTRO");
    expect(renderShell(state, 120, 30).join("\n")).not.toContain("MAESTRO");
    expect(output).not.toContain("Secretary");
  });

  it("shows a stop hint while a conversation turn is active", () => {
    const output = renderTuiFooter(80, { ...state, working: true });
    expect(output).toContain("esc stop");
    expect(output).not.toContain("/ commands");
  });

  it("keeps setup-required distinct from a runtime connection error", () => {
    const output = renderStatusHeader(
      { ...state, connection: { kind: "setup-required", message: "Control Plane connection is not configured" } },
      200,
    ).join("\n");
    expect(output).toContain("Control Plane connection is not configured");
    expect(output).toContain("⚠");
  });

  it("renders explicit loading and error states instead of fake values", () => {
    const output = renderStatusHeader({ ...state, connection: { kind: "error", message: "Control Plane unavailable" } }, 80).join("\n");
    expect(output).toContain("Control Plane unavailable");
    expect(output).not.toContain("0 workers");
  });

  it("keeps the status row fixed-size as the terminal grows taller", () => {
    expect(renderStatusHeader(state, 120, 50)).toHaveLength(1);
    expect(renderStatusHeader(state, 120, 30)).toHaveLength(1);
  });

  it("renders the first-frame splash as a bounded region", () => {
    const splash = renderTuiLayout(state, 120, 30, { showSplash: true }).splash;
    expect(splash[0]).toContain("MAESTRO");
    expect(splash).toHaveLength(3);
  });

  it("renders truthful setup progress with distinct status glyphs", () => {
    const steps: SetupStep[] = [
      { step: "docker-check", status: "completed" },
      { step: "postgres-ready", status: "started" },
      { step: "migrations", status: "pending" },
      { step: "control-plane-up", status: "failed", message: "Control Plane is not reachable" },
    ];
    const output = renderSetupSteps({ ...state, connection: { kind: "setup-required", message: "starting" }, setupSteps: steps }, 60).join("\n");
    expect(output).toContain("✓");
    expect(output).toContain("›");
    expect(output).toContain("·");
    expect(output).toContain("×");
    expect(output).toContain("Control Plane is not reachable");
    expect(output.split("\n").every((line) => line.length <= 60)).toBe(true);
  });

  it("renders setup progress at the narrow supported width", () => {
    const setupSteps: SetupStep[] = [
      { step: "docker-check", status: "completed" },
      { step: "postgres-ready", status: "started" },
      { step: "migrations", status: "pending" },
      { step: "control-plane-up", status: "pending" },
      { step: "model-gateway-up", status: "pending" },
    ];
    const output = renderSetupSteps({ ...state, connection: { kind: "setup-required", message: "starting" }, setupSteps }, 40);
    expect(output.length).toBeGreaterThan(0);
    expect(output.every((line) => line.length <= 40)).toBe(true);
  });

  it("clears setup progress once the Control Plane is connected", () => {
    expect(renderSetupSteps({ ...state, setupSteps: [{ step: "docker-check", status: "completed" }] }, 80)).toEqual([]);
  });

  it("keeps splash copy separate from the status row", () => {
    const frame = renderTuiLayout(state, 120, 30, { showSplash: true });
    expect(frame.status).toHaveLength(1);
    expect(frame.splash.findIndex((line) => line.includes("Your durable workspace"))).toBe(1);
  });
});
