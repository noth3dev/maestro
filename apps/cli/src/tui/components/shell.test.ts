import { describe, expect, it } from "vitest";
import {
  createSplashController,
  renderInputPlaceholder,
  renderSetupSteps,
  renderShell,
  renderSplash,
  renderStatusHeader,
  renderStatusRegion,
  renderTuiFooter,
  renderTuiLayout,
  type SetupStep,
  type TuiShellState,
} from "./shell.js";
import { getZeroArgumentNoGoalActions } from "../commands/registry.js";

const state: TuiShellState = {
  workspace: { cwd: "/work/acme", gitRoot: "/work/acme" },
  connection: { kind: "connected" },
  goal: { kind: "empty" },
  workers: { kind: "empty" },
  approvals: { kind: "empty" },
  budget: { kind: "empty" },
};

// ANSI escapes do not consume terminal columns; width assertions inspect visible text.
// eslint-disable-next-line no-control-regex
const stripAnsi = (value: string): string => value.replace(/\u001b\[[0-9;]*m/g, "");

describe("Maestro TUI shell", () => {
  it("renders a Prime-style loader with truthful activity and elapsed state", () => {
    const output = stripAnsi(
      renderInputPlaceholder(
        {
          ...state,
          working: true,
          workingSince: Date.now() - 1_000,
          workingTick: 1,
          conversationActivity: { phase: "executing", toolName: "readGoal" },
        },
        120,
      ),
    );
    expect(output).toContain("⠙");
    expect(output).toContain("Executing readGoal");
    expect(output).toContain("1s");
    expect(output).toContain("esc stop");
    const checked = stripAnsi(
      renderInputPlaceholder(
        {
          ...state,
          working: true,
          workingSince: Date.now(),
          conversationActivity: { phase: "tool-result", toolName: "readGoal", status: "ok" },
        },
        120,
      ),
    );
    expect(checked).toContain("✓ Checking result readGoal");
    const failed = stripAnsi(
      renderInputPlaceholder(
        {
          ...state,
          working: true,
          workingSince: Date.now(),
          conversationActivity: { phase: "tool-result", toolName: "readGoal", status: "error" },
        },
        120,
      ),
    );
    expect(failed).toContain("✗ Checking result readGoal");
  });

  it("uses Maestro branding only on the first splash frame", () => {
    const output = renderShell(state, 120, 30, { showSplash: true }).join("\n");
    expect(output).toContain("MAESTRO");
    expect(renderShell(state, 120, 30).join("\n")).not.toContain("MAESTRO");
    expect(output).not.toContain("Secretary");
  });

  it("advertises a copyable help command for first-time users", () => {
    for (const width of [40, 60, 80]) {
      const output = stripAnsi(renderTuiFooter(width, state));
      expect(output).toBe("/ commands · ctrl+g goals · /help");
      expect(output).not.toContain("? help");
      expect(output).not.toContain("ctrl+k help");
      expect(output.length).toBeLessThanOrEqual(width);
    }
  });

  it("shows retry guidance when project discovery fails", () => {
    const failedDiscovery = {
      ...state,
      project: { kind: "unavailable", guidance: "Project discovery unavailable: gateway timeout" },
    } as TuiShellState;

    for (const width of [40, 80]) {
      const splash = stripAnsi(renderSplash(failedDiscovery, width).join("\n"));
      const footer = stripAnsi(renderTuiFooter(width, failedDiscovery));
      expect(splash).not.toContain("/session attach");
      expect(splash).toContain("Project discovery failed");
      expect(splash).toContain("ctrl+r retry");
      expect(footer).not.toContain("/session attach");
      expect(footer).toContain("ctrl+r retry");
      expect(splash.split("\n").every((line) => line.length <= width)).toBe(true);
      expect(footer.length).toBeLessThanOrEqual(width);
    }
  });

  it("shows provisioning and retry guidance when no projects are available", () => {
    const zeroProjects = {
      ...state,
      project: { kind: "unavailable", guidance: "No projects are available for this operator" },
    } as TuiShellState;

    for (const width of [40, 80]) {
      const splash = stripAnsi(renderSplash(zeroProjects, width).join("\n"));
      const footer = stripAnsi(renderTuiFooter(width, zeroProjects));
      expect(splash).not.toContain("/session attach");
      expect(splash).toMatch(/ask admin|admin provision/);
      expect(splash).toContain("ctrl+r");
      expect(footer).not.toContain("/session attach");
      expect(footer).toMatch(/ask admin|admin provision/);
      expect(footer).toContain("ctrl+r");
      expect(splash.split("\n").every((line) => line.length <= width)).toBe(true);
      expect(footer.length).toBeLessThanOrEqual(width);
    }
  });

  it("uses project recovery guidance in the normal-height input placeholder", () => {
    const unavailableStates = [
      { ...state, project: { kind: "unavailable", guidance: "No projects are available for this operator" } },
      { ...state, project: { kind: "unavailable", guidance: "Project discovery unavailable: gateway timeout" } },
      {
        ...state,
        project: {
          kind: "unavailable",
          guidance: "Multiple projects are available; choose one: /session attach --project-index=1 or /session attach --project-index=2",
        },
      },
    ] as TuiShellState[];

    for (const width of [40, 80]) {
      for (const unavailable of unavailableStates) {
        const input = renderInputPlaceholder(unavailable, width);
        expect(input).not.toContain("message to Concertmaster");
        expect(input.length).toBeLessThanOrEqual(width);
      }
    }

    expect(renderInputPlaceholder(unavailableStates[0]!, 80)).toContain("ask admin");
    expect(renderInputPlaceholder(unavailableStates[1]!, 80)).toContain("ctrl+r retry");
    expect(renderInputPlaceholder(unavailableStates[2]!, 80)).toBe("/session attach --project-index=1");
  });

  it("shows attach guidance instead of project-bound actions when project discovery is unresolved", () => {
    const unresolved = {
      ...state,
      project: {
        kind: "unavailable",
        guidance: "Multiple projects are available; choose one: /session attach --project-index=1 or /session attach --project-index=2",
      },
    } as TuiShellState;

    for (const width of [40, 60, 80, 120]) {
      const splash = renderSplash(unresolved, width).map(stripAnsi).join("\n");
      const footer = stripAnsi(renderTuiFooter(width, unresolved));
      expect(splash).not.toMatch(/\/goal create|\/projection read|\/billing get|ctrl\+g goals/);
      expect(splash).toContain("/session attach --project-index=1");
      expect(footer).toBe("/session attach --project-index=1");
      expect(splash.split("\n").every((line) => line.length <= width)).toBe(true);
      expect(footer.length).toBeLessThanOrEqual(width);
    }

    const attached = renderSplash(state, 80).join("\n");
    expect(attached).toContain("/goal create");

    const disconnected = renderSplash({ ...unresolved, connection: { kind: "error", message: "gateway unavailable" } }, 80).join("\n");
    expect(disconnected).toContain("Next: /goal create");
  });

  it("keeps disconnected recovery hints truthful and copyable", () => {
    const connections: TuiShellState["connection"][] = [
      { kind: "connecting" },
      { kind: "setup-required", message: "Control Plane setup required" },
      { kind: "error", message: "Control Plane unavailable" },
    ];
    for (const connection of connections) {
      for (const width of [40, 80, 120]) {
        const output = stripAnsi(renderTuiFooter(width, { ...state, connection }));
        if (connection.kind === "setup-required") {
          expect(output).toContain("restart");
          expect(output).not.toContain("ctrl+r retry");
        } else {
          expect(output).toBe("ctrl+r retry · /help for commands");
        }
        expect(output).not.toContain("/status");
        expect(output.length).toBeLessThanOrEqual(width);
      }
    }
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

  it("uses distinct addressee-aware placeholders for idle, work, and pending decisions", () => {
    const idle = renderTuiLayout(state, 80, 30).input[0];
    const working = renderTuiLayout({ ...state, working: true }, 80, 30).input[0];
    const pending = renderTuiLayout(
      {
        ...state,
        pendingDecisions: [{ identity: "decision-1", tier: "Council", action: "approve", actor: "operator" }],
      },
      80,
      30,
    ).input[0];
    expect(idle).toBe("message to Concertmaster · Enter to send");
    expect(working).toContain("in progress");
    expect(pending).toContain("Council");
    expect(new Set([idle, working, pending]).size).toBe(3);
  });

  it("does not invent a running Department Head or worker identity", () => {
    const input = renderTuiLayout({ ...state, working: true }, 80, 30).input[0];
    expect(input).toContain("Concertmaster");
    expect(input).not.toContain("Department Head");
    expect(input).not.toContain("worker");
  });

  it("uses known Goal and worker values when work is in flight", () => {
    const input = renderTuiLayout(
      {
        ...state,
        working: true,
        goal: { kind: "value", value: { goalId: "auth-refactor", name: "auth-refactor", state: "running" } },
        workers: { kind: "value", value: 2 },
      },
      80,
      30,
    ).input[0];
    expect(input).toContain("auth-refactor");
    expect(input).toContain("2 workers");
  });

  it("keeps pending placeholder tier and count aligned with the decision region", () => {
    const pendingState = {
      ...state,
      pendingDecisions: [
        { identity: "decision-1", tier: "Council", action: "approve", actor: "operator" },
        { identity: "decision-2", tier: "Council", action: "reject", actor: "operator" },
      ],
    };
    const frame = renderTuiLayout(pendingState, 80, 30);
    expect(frame.input[0]).toContain("Council");
    expect(frame.input[0]).toContain("2 pending decisions");
    expect(frame.decisions.join("\n")).toContain("Council");
    expect(frame.decisions.join("\n")).toContain("approve");
    expect(frame.decisions.join("\n")).toContain("reject");
  });

  it("bounds addressee-aware placeholders at existing terminal widths", () => {
    const states = [
      state,
      { ...state, working: true },
      { ...state, pendingDecisions: [{ identity: "decision-1", tier: "Council", action: "approve", actor: "operator" }] },
    ];
    for (const width of [40, 60, 80, 120]) {
      for (const candidate of states) expect(renderTuiLayout(candidate, width, 30).input[0].length).toBeLessThanOrEqual(width);
    }
  });

  it("renders the first-frame splash as a bounded region", () => {
    const splash = renderTuiLayout(state, 120, 30, { showSplash: true }).splash;
    expect(splash[0]).toContain("MAESTRO");
    expect(splash).toHaveLength(3);
  });

  it("renders a degraded splash at the narrow supported width", () => {
    const splash = renderTuiLayout(state, 40, 30, { showSplash: true }).splash;
    expect(splash.length).toBeGreaterThan(0);
    expect(splash.every((line) => stripAnsi(line).length <= 40)).toBe(true);
    expect(splash.join("\n")).toContain("ctrl+/");
  });

  it("orients a no-Goal operator around the live standing organization", () => {
    const oriented = {
      ...state,
      organization: { kind: "value", value: { departments: ["Product Department", "Quality Department"] } },
    } as TuiShellState;
    const splash = renderSplash(oriented, 120).join("\n");
    const nextActions = getZeroArgumentNoGoalActions()
      .map((action) => `/${action.command} ${action.action}`)
      .join(" · ");
    expect(splash).toContain("Concertmaster ready");
    expect(splash).toContain("2 Department Heads");
    expect(splash).toContain(`Next: ${nextActions}`);
    expect(splash).not.toContain("/task-contract create");
    expect(splash).not.toContain("/council create");
  });

  it("orients an attached Goal from the same state values as the status row without pressure", () => {
    const oriented = {
      ...state,
      goal: { kind: "value", value: { goalId: "auth-refactor", name: "auth-refactor", state: "running", pressureBand: "high" } },
      workers: { kind: "value", value: 3 },
    } as unknown as TuiShellState;
    const splash = renderSplash(oriented, 120).join("\n");
    expect(splash).toContain("auth-refactor");
    expect(splash).toContain("running");
    expect(splash).toContain("3 workers");
    expect(splash).not.toContain("pressure");
    expect(splash).not.toContain("high");
  });

  it("yields the splash entirely to pending authority decisions", () => {
    const oriented = { ...state, pendingDecisions: [{ identity: "decision-1", tier: "You", action: "approve", actor: "operator" }] };
    expect(renderSplash(oriented, 120)).toEqual([]);
    expect(renderTuiLayout(oriented, 120, 30, { showSplash: true }).decisions.join("\n")).toContain("approve");
  });

  it("can recover a dismissed splash with the documented restore action", () => {
    const splash = createSplashController();
    splash.dismiss();
    expect(splash.visible()).toBe(false);
    splash.restore();
    expect(splash.visible()).toBe(true);
  });

  it("gives setup-required operators a concrete restart path", () => {
    const setupRequired = { ...state, connection: { kind: "setup-required", message: "Control Plane is not configured" } } as TuiShellState;
    for (const [width, height] of [
      [80, 24],
      [40, 15],
    ] as const) {
      const frame = renderTuiLayout(setupRequired, width, height);
      const output = [...frame.status, ...frame.input, ...frame.hints].join("\n");
      expect(output).toContain("restart");
      expect(output).not.toContain("message to Concertmaster");
      expect(output).not.toContain("retry with ctrl+r");
      expect(output.split("\n").every((line) => stripAnsi(line).length <= width)).toBe(true);
    }
    const normal = renderTuiLayout(setupRequired, 80, 24);
    expect(normal.status.join("\n")).toContain("MAESTRO_API_URL");
    expect(normal.status.join("\n")).toContain("MAESTRO_API_TOKEN");
  });

  it("renders truthful setup progress with distinct status glyphs", () => {
    const steps: SetupStep[] = [
      { step: "docker-check", status: "completed" },
      { step: "postgres-ready", status: "started" },
      { step: "migrations", status: "pending" },
      { step: "control-plane-up", status: "failed", message: "Control Plane is not reachable" },
    ];
    const output = renderSetupSteps({ ...state, connection: { kind: "setup-required", message: "starting" }, setupSteps: steps }, 60).join(
      "\n",
    );
    expect(output).toContain("✓");
    expect(output).toContain("›");
    expect(output).toContain("·");
    expect(output).toContain("×");
    expect(output).toContain("Control Plane is not reachable");
    expect(output.split("\n").every((line) => line.length <= 60)).toBe(true);
  });

  it("omits Docker-specific setup language for the embedded database path", () => {
    const output = renderSetupSteps(
      {
        ...state,
        connection: { kind: "setup-required", message: "starting" },
        setupSteps: [{ step: "postgres-ready", status: "completed", message: "Embedded PostgreSQL-compatible database is ready" }],
      },
      80,
    ).join("\n");
    expect(output).not.toContain("Docker");
    expect(output).toContain("PostgreSQL ready");
  });

  it("does not invent local setup progress before any bootstrap callback", () => {
    const output = renderSetupSteps(
      { ...state, connection: { kind: "setup-required", message: "Control Plane connection is not configured" } },
      80,
    );
    expect(output).toEqual([]);
    const status = renderStatusRegion(
      { ...state, connection: { kind: "setup-required", message: "Control Plane connection is not configured" } },
      80,
      24,
    ).join("\n");
    expect(status).toContain("MAESTRO_API_URL");
    expect(status).not.toContain("Docker check");
    expect(status).not.toContain("Model gateway");
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

  it("keeps splash orientation copy separate from the status row", () => {
    const frame = renderTuiLayout(state, 120, 30, { showSplash: true });
    expect(frame.status).toHaveLength(1);
    expect(frame.splash.findIndex((line) => line.includes("Concertmaster ready"))).toBe(1);
  });
});
