import { describe, expect, it } from "vitest";
import { renderActivityTimeline } from "./activity-timeline.js";
import { createSplashController, renderDecisionRegion, renderStatusRow, renderTuiLayout, type PendingDecision, type TuiShellState } from "./shell.js";
import { createStatusRegion } from "./regions.js";

const state: TuiShellState = {
  workspace: { cwd: "/work/acme", gitRoot: "/work/acme" },
  model: "test/model",
  mode: "maestro",
  connection: { kind: "connected" },
  goal: { kind: "value", value: { name: "auth-refactor", state: "running" } },
  workers: { kind: "value", value: 3 },
  approvals: { kind: "value", value: 0 },
  budget: { kind: "value", value: { spentCents: 124, ceilingCents: 500 } },
};

const pendingState: TuiShellState = {
  ...state,
  approvals: { kind: "value", value: 2 },
  pendingDecisions: [
    { identity: "effect-1", tier: "Encore Council", action: "git push origin main", actor: "worker-3" },
    { identity: "effect-2", tier: "You", action: "rm -rf build/", actor: "worker-1" },
    { identity: "effect-3", tier: "Head", action: "deploy release", actor: "worker-2" },
  ],
};

// eslint-disable-next-line no-control-regex
function plain(value: string): string { return value.replace(/\u001b\[[0-9;]*m/g, ""); }

describe("Maestro TUI layout and hierarchy", () => {
  it("gives the stream at least 70 percent of an 80x24 frame at rest", () => {
    const frame = renderTuiLayout(state, 80, 24, { stream: ["conversation"] });
    expect(frame.stream.length).toBeGreaterThanOrEqual(Math.ceil(24 * 0.7));
  });

  it("shows a pending decision without opening a panel", () => {
    const frame = renderTuiLayout(pendingState, 100, 24, { stream: ["conversation"] });
    expect(frame.decisions.join("\n")).toContain("git push origin main");
    expect(frame.decisions.join("\n")).toContain("Encore Council");
    expect(renderTuiLayout(pendingState, 80, 24).decisions.join("\n")).not.toContain("worker-3");
    expect(renderTuiLayout(pendingState, 100, 24).decisions.join("\n")).toContain("worker-3");
  });

  it("removes the decisions region when nothing is pending", () => {
    expect(renderTuiLayout(state, 100, 24).decisions).toEqual([]);
  });

  it("does not render a pending row without durable identity", () => {
    const malformed = { tier: "You", action: "git push origin main", actor: "You" } as PendingDecision;
    expect(renderDecisionRegion({ ...pendingState, pendingDecisions: [malformed] }, 100, 24)).toEqual([]);
  });

  it("renders the splash on the first frame only", () => {
    const splash = createSplashController();
    expect(renderTuiLayout(state, 120, 30, { showSplash: splash.visible() }).splash.length).toBeGreaterThan(0);
    splash.dismiss();
    expect(renderTuiLayout(state, 120, 30, { showSplash: splash.visible() }).splash).toEqual([]);
  });

  it("consumes the splash on a cramped first render", () => {
    let height = 10;
    const splash = createSplashController();
    const region = createStatusRegion({ state, height: () => height, splash });

    expect(splash.visible()).toBe(true);
    region.render(80);
    expect(splash.visible()).toBe(false);
    height = 30;
    region.render(120);
    expect(splash.visible()).toBe(false);
  });

  it("drops status fields in the documented width order", () => {
    expect(plain(renderStatusRow(state, 120))).toContain("$1.24/$5.00");
    expect(plain(renderStatusRow(state, 80))).not.toContain("$1.24/$5.00");
    expect(plain(renderStatusRow(state, 80))).toContain("3 workers");
    expect(plain(renderStatusRow(state, 70))).not.toContain("3 workers");
    expect(plain(renderStatusRow(state, 70))).toContain("maestro ·");
    expect(plain(renderStatusRow(state, 70))).toContain("running");
    expect(plain(renderStatusRow(state, 70))).not.toContain("auth-refactor");
    expect(plain(renderStatusRow(state, 50))).not.toContain("maestro ·");
    expect(plain(renderStatusRow(state, 50))).toContain("running");
    expect(plain(renderStatusRow(state, 50))).not.toContain("auth-refactor");
  });

  it("renders only status and input below 16 rows", () => {
    const frame = renderTuiLayout(pendingState, 80, 15, { stream: ["conversation"] });
    expect(frame.status).toHaveLength(1);
    expect(frame.stream).toEqual([]);
    expect(frame.decisions).toEqual([]);
    expect(frame.input.length).toBeGreaterThan(0);
    expect(frame.hints).toEqual([]);
  });

  it("keeps a glyph beside each coloured state when colour is disabled", () => {
    const previous = process.env.NO_COLOR;
    process.env.NO_COLOR = "";
    try {
      const frame = renderTuiLayout({ ...pendingState, connection: { kind: "error", message: "gateway unavailable" } }, 100, 24);
      const output = plain([...frame.status, ...frame.decisions].join("\n"));
      expect(output).toMatch(/[⚠⏸]/);
    } finally {
      if (previous === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = previous;
    }
  });

  it("keeps organization events in the stream without a panel", () => {
    const events = ["head_activated", "council_convened", "certification_issued"].map((eventType, index) => ({
      cursor: String(index + 1), eventType,
    }));
    const stream = renderActivityTimeline(events, 100).join("\n");
    expect(stream).toContain("head_activated");
    expect(stream).toContain("council_convened");
    expect(stream).toContain("certification_issued");
  });

  it("replaces the status row with connection trouble instead of augmenting it", () => {
    const frame = renderTuiLayout({ ...state, connection: { kind: "error", message: "gateway unavailable" } }, 100, 24);
    expect(frame.status).toHaveLength(1);
    expect(plain(frame.status[0]!)).toContain("gateway unavailable");
    expect(plain(frame.status[0]!)).not.toContain("auth-refactor");
    expect(plain(frame.status[0]!)).not.toContain("$1.24/$5.00");
  });
});
