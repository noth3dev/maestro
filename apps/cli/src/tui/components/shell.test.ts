import { describe, expect, it } from "vitest";
import { renderShell, renderStatusHeader, renderTuiFooter, renderTuiLayout, type TuiShellState } from "./shell.js";

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

  it("keeps splash copy separate from the status row", () => {
    const frame = renderTuiLayout(state, 120, 30, { showSplash: true });
    expect(frame.status).toHaveLength(1);
    expect(frame.splash.findIndex((line) => line.includes("Your durable workspace"))).toBe(1);
  });
});
