import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ModelCatalogEntry } from "@maestro/contracts";
import { describe, expect, it } from "vitest";
import { ReasoningDial, defaultReasoningEffort } from "./ReasoningDial.js";

const model: ModelCatalogEntry = {
  identity: { provider: "openai-codex", id: "gpt-5.6-sol" },
  capabilities: ["text"],
  authModes: ["managed-subscription"],
  reasoningEfforts: { supported: ["low", "high"], default: "high" },
  dataPolicy: { allowedDataClasses: ["public"], retention: "provider-policy", trainsOnCustomerData: false, regions: ["US"] },
};

describe("ReasoningDial", () => {
  it("uses the provider model default and exposes only advertised choices", () => {
    expect(defaultReasoningEffort(model)).toBe("high");
    const html = renderToStaticMarkup(<ReasoningDial model={model} value="high" onChange={() => undefined} id="test-reasoning" />);
    expect(html).toContain("Thinking strength");
    expect(html).toContain("High");
    expect(html).toContain('max="1"');
    expect(html).not.toContain("medium");
  });

  it("shows provider default and disables the dial when no metadata is available", () => {
    const html = renderToStaticMarkup(
      <ReasoningDial model={{ ...model, reasoningEfforts: undefined }} value={undefined} onChange={() => undefined} />,
    );
    expect(html).toContain("provider default");
    expect(html).toContain("disabled");
    expect(html).not.toContain('max="1"');
  });
});
