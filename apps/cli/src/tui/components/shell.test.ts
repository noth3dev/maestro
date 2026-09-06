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
    expect(output).toContain("MAESTRO / CONCERTMASTER");
    expect(output).toContain("/work/acme");
    expect(output).not.toContain("Secretary");
  });

  it("renders explicit loading and error states instead of fake values", () => {
    const output = renderStatusHeader({ ...state, connection: { kind: "error", message: "Control Plane unavailable" } }, 80).join("\n");
    expect(output).toContain("Control Plane unavailable");
    expect(output).not.toContain("0 workers");
  });
});
