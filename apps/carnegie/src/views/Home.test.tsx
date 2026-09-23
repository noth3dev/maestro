import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Home, submitHomeComposer } from "./Home.js";

vi.mock("../connection.js", () => ({ useConnection: () => ({ config: { projectId: "11111111-1111-4111-8111-111111111111" } }) }));
vi.mock("../goals.js", () => ({ useGoals: () => ({ selectedGoalId: undefined }) }));
vi.mock("../icons.js", () => ({ Icon: () => null }));
vi.stubGlobal("React", React);

describe("Home Concertmaster conversation", () => {
  it("keeps the initial composer focused before a conversation exists", () => {
    const html = renderToStaticMarkup(<Home onNavigate={vi.fn()} mode="maestro" onModeChange={vi.fn()} />);
    expect(html).toContain("Brief the Concertmaster");
    expect(html).toContain("Concertmaster model");
    expect(html).toContain('id="home-concertmaster-model"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain("conversation not started");
    expect(html).not.toContain("continue conversation");
    expect(html).not.toContain("retry turn");
    expect(html).not.toContain("cancel turn");
  });

  it("keeps the deferred Flashmob composer from submitting", () => {
    const html = renderToStaticMarkup(<Home onNavigate={vi.fn()} mode="flashmob" onModeChange={vi.fn()} />);

    expect(html).toContain("Flashmob is deferred");
    expect(html).toMatch(/textarea[^>]*disabled/);
    expect(html).toMatch(/button[^>]*disabled[^>]*>send/);
    expect(html).not.toContain("fix the pricing page copy");
  });


  it("does not invoke the backend submitter for deferred Flashmob mode", () => {
    const preventDefault = vi.fn();
    const submitBackend = vi.fn();

    submitHomeComposer("flashmob", { preventDefault }, submitBackend);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(submitBackend).not.toHaveBeenCalled();
  });

  it("invokes the backend submitter only for Maestro mode", () => {
    const preventDefault = vi.fn();
    const submitBackend = vi.fn();

    submitHomeComposer("maestro", { preventDefault }, submitBackend);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(submitBackend).toHaveBeenCalledOnce();
  });

});
