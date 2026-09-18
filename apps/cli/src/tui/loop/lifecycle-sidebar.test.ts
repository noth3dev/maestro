import { describe, expect, it, vi } from "vitest";
import { LifecycleHandler } from "./lifecycle.js";
import type { TuiController } from "./controller.js";

// Control bytes use \u escapes: raw ESC bytes do not survive file tooling round-trips.
const CTRL_B = "";
const CTRL_G = "";
const ESC = "";
const UP = "[A";
const DOWN = "[B";

function stubController() {
  return {
    pendingProviderLogin: undefined,
    providerLoginInFlight: false,
    compactHelp: undefined,
    compactModelList: undefined,
    compactTaskContractReview: false,
    compactConversationResult: undefined,
    compactCommandResult: undefined,
    compactReview: undefined,
    accountLoginState: undefined,
    accountLoginSelection: undefined,
    pendingProviderLoginOperation: undefined,
    sidebarVisible: false,
    sidebarFocus: undefined as string | undefined,
    pendingConfirmation: undefined as { summary: Record<string, unknown>; resolve: (decision: string) => void } | undefined,
    state: { pendingDecisions: [] },
    terminal: { columns: 120, rows: 30 },
    sidebarGoals: [] as Array<{ goalId: string }>,
    splash: { dismiss: vi.fn(), restore: vi.fn() },
    tui: { requestRender: vi.fn() },
    view: { render: vi.fn(), append: vi.fn(), appendWarning: vi.fn(), syncPendingDecisionState: vi.fn() },
    editor: { setText: vi.fn() },
    submitter: { submit: vi.fn() },
  };
}

describe("sidebar focus keys", () => {
  it("toggles visibility and focuses the first row on ctrl+b", () => {
    const c = stubController();
    const handler = new LifecycleHandler(c as unknown as TuiController);
    expect(handler.handleInput(CTRL_B)).toEqual({ consume: true });
    expect(c.sidebarVisible).toBe(true);
    expect(c.sidebarFocus).toBe("home");
    expect(c.view.render).toHaveBeenCalled();
    expect(handler.handleInput(CTRL_B)).toEqual({ consume: true });
    expect(c.sidebarVisible).toBe(false);
    expect(c.sidebarFocus).toBeUndefined();
  });

  it("moves focus and activates rows while focused", () => {
    const c = stubController();
    c.sidebarVisible = true;
    c.sidebarFocus = "home";
    const handler = new LifecycleHandler(c as unknown as TuiController);
    expect(handler.handleInput(UP)).toEqual({ consume: true });
    expect(c.sidebarFocus).toBe("luthiery");
    expect(handler.handleInput(DOWN)).toEqual({ consume: true });
    expect(c.sidebarFocus).toBe("home");
    expect(handler.handleInput("\r")).toEqual({ consume: true });
    expect(c.submitter.submit).not.toHaveBeenCalled();
    c.sidebarFocus = "channel";
    expect(handler.handleInput("\r")).toEqual({ consume: true });
    expect(c.submitter.submit).toHaveBeenCalledWith("/channel list");
  });

  it("returns focus on escape and consumes other keys while focused", () => {
    const c = stubController();
    c.sidebarVisible = true;
    c.sidebarFocus = "home";
    const handler = new LifecycleHandler(c as unknown as TuiController);
    expect(handler.handleInput(ESC)).toEqual({ consume: true });
    expect(c.sidebarFocus).toBeUndefined();
    expect(c.sidebarVisible).toBe(true);
    c.sidebarFocus = "home";
    expect(handler.handleInput("a")).toEqual({ consume: true });
    expect(c.view.append).not.toHaveBeenCalled();
  });

  it("lets control shortcuts fall through while focused", () => {
    const c = stubController();
    c.sidebarVisible = true;
    c.sidebarFocus = "home";
    const handler = new LifecycleHandler(c as unknown as TuiController);
    expect(handler.handleInput(CTRL_G)).toEqual({ consume: true });
    expect(c.submitter.submit).toHaveBeenCalledWith("/goals list");
    expect(c.sidebarFocus).toBe("home");
  });

  it("ignores nav keys while a confirmation owns input", () => {
    const c = stubController();
    c.sidebarVisible = true;
    c.sidebarFocus = "home";
    c.pendingConfirmation = { summary: {}, resolve: vi.fn() };
    const handler = new LifecycleHandler(c as unknown as TuiController);
    expect(handler.handleInput(UP)).toBeUndefined();
    expect(c.sidebarFocus).toBe("home");
    expect(c.view.render).not.toHaveBeenCalled();
  });

  it("activates cached goal rows with enter", () => {
    const c = stubController();
    c.sidebarVisible = true;
    c.sidebarGoals = [{ goalId: "goal-1" }];
    c.sidebarFocus = "goal-1";
    const handler = new LifecycleHandler(c as unknown as TuiController);
    expect(handler.handleInput("\r")).toEqual({ consume: true });
    expect(c.submitter.submit).toHaveBeenCalledWith("/goal select --goal-id goal-1");
  });

  it("moves focus across cached goal rows", () => {
    const c = stubController();
    c.sidebarVisible = true;
    c.sidebarGoals = [{ goalId: "goal-1" }];
    c.sidebarFocus = "luthiery";
    const handler = new LifecycleHandler(c as unknown as TuiController);
    expect(handler.handleInput(DOWN)).toEqual({ consume: true });
    expect(c.sidebarFocus).toBe("goal-1");
    expect(handler.handleInput(DOWN)).toEqual({ consume: true });
    expect(c.sidebarFocus).toBe("home");
  });
});
