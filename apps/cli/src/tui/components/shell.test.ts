import { describe, expect, it } from "vitest";
import { renderShell, renderStatusHeader, type TuiShellState } from "./shell.js";

const state: TuiShellState = {
  workspace: { cwd: "/work/acme", gitRoot: "/work/acme" },
  connection: { kind: "connected" },
  goal: { kind: "empty" },
  workers: { kind: "empty" },
  approvals: { kind: "empty" },
  budget: { kind: "empty" },
};

describe("Maestro TUI shell", () => {
  it("uses Maestro and Concertmaster branding", () => {
    const output = renderShell(state, 80).join("\n");
    expect(output).toContain("MAESTRO");
    expect(output).toContain("/work/acme");
    expect(output).not.toContain("Secretary");
  });

  it("keeps setup-required distinct from a runtime connection error", () => {
    const output = renderStatusHeader(
      { ...state, connection: { kind: "setup-required", message: "Control Plane connection is not configured" } },
      200,
    ).join("\n");
    expect(output).toContain("setup required");
    expect(output).toContain("Control Plane connection is not configured");
  });

  it("renders explicit loading and error states instead of fake values", () => {
    const output = renderStatusHeader({ ...state, connection: { kind: "error", message: "Control Plane unavailable" } }, 80).join("\n");
    expect(output).toContain("Control Plane unavailable");
    expect(output).not.toContain("0 workers");
  });

  it("keeps the logo fixed-size as the terminal grows taller", () => {
    expect(renderStatusHeader(state, 120, 50)).toHaveLength(renderStatusHeader(state, 120, 30).length);
  });

  it("keeps the logo's upper contour instead of clipping its first artwork row", () => {
    const header = renderStatusHeader(state, 120, 30);
    expect(header.some((line) => line.includes("⢀⡀"))).toBe(true);
  });
});
