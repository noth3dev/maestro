import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderSignIn } from "./ProviderSignIn.js";

vi.mock("../icons.js", () => ({ Icon: () => null }));

describe("ProviderSignIn", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("offers ChatGPT and Claude account sign-in without an API-key form", () => {
    vi.stubGlobal("window", { maestro: { api: {}, external: { openProviderAuth: vi.fn() } } });
    const html = renderToStaticMarkup(<ProviderSignIn onConnected={vi.fn()} />);
    expect(html).toContain("Connect a model account to start");
    expect(html).toContain("sign in with ChatGPT");
    expect(html).toContain("sign in with Claude");
    expect(html).not.toContain('type="password"');
  });
});
