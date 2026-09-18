import { describe, expect, it, vi } from "vitest";
import { LifecycleHandler } from "./lifecycle.js";
import type { TuiController } from "./controller.js";

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
    pendingConfirmation: undefined,
    state: { pendingDecisions: [] },
    terminal: { columns: 120, rows: 30 },
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
    expect(handler.handleInput("")).toEqual({ consume: true });
    expect(c.sidebarVisible).toBe(true);
    expect(c.sidebarFocus).toBe("home");
    expect(c.view.render).toHaveBeenCalled();
    expect(handler.handleInput("")).toEqual({ consume: true });
    expect(c.sidebarVisible).toBe(false);
    expect(c.sidebarFocus).toBeUndefined();
  });

  it("moves focus and activates rows while focused", () => {
    const c = stubController();
    c.sidebarVisible = true;
    c.sidebarFocus = "home";
    const handler = new LifecycleHandler(c as unknown as TuiController);
    expect(handler.handleInput("[A")).toEqual({ consume: true });
    expect(c.sidebarFocus).toBe("luthiery");
    expect(handler.handleInput("[B")).toEqual({ consume: true });
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
    expect(handler.handleInput("")).toEqual({ consume: true });
    expect(c.sidebarFocus).toBeUndefined();
    expect(c.sidebarVisible).toBe(true);
    c.sidebarFocus = "home";
    expect(handler.handleInput("a")).toEqual({ consume: true });
    expect(c.view.append).not.toHaveBeenCalled();
  });
});
