import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Luthiery } from "./Luthiery.js";

vi.stubGlobal("React", React);


vi.mock("../icons.js", () => ({ Icon: () => null }));

describe("Luthiery view", () => {
  it.each(["skills", "tools"] as const)("does not present illustrative %s rows when no durable registry exists", (initialTab) => {
    const html = renderToStaticMarkup(<Luthiery initialTab={initialTab} />);

    expect(html).toContain(`No durable ${initialTab === "skills" ? "skill" : "tool"} registry is available`);
    expect(html).toContain("backend-blocked");
    expect(html).toContain("listSkills");
    expect(html).toContain("getSkill");
    expect(html).toContain("certification");
    expect(html).toContain("usage");
    expect(html).toContain("Phase 9");
    expect(html).toContain("re-entry");
    expect(html).not.toContain("docx generation");
    expect(html).not.toContain("stripe-webhook-relay mcp");
    expect(html).not.toContain("reused ×");
  });
});
