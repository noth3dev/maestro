import { describe, expect, it, vi } from "vitest";
import { TuiView } from "../loop/view.js";
import { renderMainPage, type MainPageState } from "./main-page.js";

// eslint-disable-next-line no-control-regex
const plain = (value: string): string => value.replace(/\u001b\[[0-9;]*m/g, "");

const context = {
  pendingDecisions: [],
  budget: { kind: "value" as const, value: { spentCents: 124, ceilingCents: 500 } },
};

describe("main destination pages", () => {
  it("gives each sidebar destination its own header and body instead of the composer copy", () => {
    const cases: Array<[string, MainPageState, string[]]> = [
      ["inbox", { viewId: "inbox", kind: "inbox" }, ["inbox", "No pending approvals."]],
      ["channel", { viewId: "channel", kind: "read", title: "Channels", lines: ["• #general · 2 messages"] }, ["channel", "Channels"]],
      ["evlog", { viewId: "evlog", kind: "read", title: "Events", lines: ["• 7 · GoalCreated"] }, ["evidence log", "Events"]],
      ["billing", { viewId: "billing", kind: "read", title: "Billing", lines: ["Daily spend · $1.24"] }, ["billing", "Billing"]],
      ["luthiery", { viewId: "luthiery", kind: "read", title: "Luthiery", lines: ["skills registry unavailable"] }, ["luthiery", "Luthiery"]],
    ];

    const rendered = cases.map(([viewId, state, expected]) => {
      const lines = renderMainPage(viewId, state, context, 80).join("\n");
      for (const fragment of expected) expect(lines).toContain(fragment);
      expect(lines).not.toContain("message to Concertmaster");
      return lines;
    });

    expect(new Set(rendered).size).toBe(cases.length);
  });

  it("keeps loading and failure states explicit and width-safe", () => {
    expect(renderMainPage("billing", { viewId: "billing", kind: "loading" }, context, 24).join("\n")).toContain("Loading billing");
    expect(renderMainPage("billing", { viewId: "billing", kind: "error", message: "offline" }, context, 24).join("\n")).toContain("offline");
    for (const line of renderMainPage("billing", { viewId: "billing", kind: "read", title: "Billing", lines: ["x".repeat(100)] }, context, 24))
      expect(plain(line).length).toBeLessThanOrEqual(24);
  });
});


describe("main page generations", () => {
  it("rejects a read result from an older page generation", () => {
    const controller = { mainPageGeneration: 4, mainPage: undefined, sidebarSelection: "billing" };
    const view = new TuiView(controller as never);
    view.render = vi.fn();

    view.setMainPageResult("billing", { title: "Billing", lines: ["old"] }, 3);
    expect(controller.mainPage).toBeUndefined();

    view.setMainPageResult("billing", { title: "Billing", lines: ["current"] }, 4);
    expect(controller.mainPage).toEqual({ viewId: "billing", kind: "read", title: "Billing", lines: ["current"] });
  });

  it("invalidates an in-flight page when cleared", () => {
    const controller = { mainPageGeneration: 0, mainPage: undefined, sidebarSelection: "billing" };
    const view = new TuiView(controller as never);
    view.render = vi.fn();

    const generation = view.beginMainPageLoading("billing");
    view.clearMainPage();
    expect(controller.mainPage).toBeUndefined();
    expect(controller.mainPageGeneration).toBe(generation + 1);

    view.setMainPageResult("billing", { title: "Billing", lines: ["late"] }, generation);
    expect(controller.mainPage).toBeUndefined();
  });
});
