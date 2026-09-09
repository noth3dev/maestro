import { afterEach, describe, expect, it } from "vitest";
import { ConversationViewport } from "./conversation-viewport.js";

const originalNoColor = process.env.NO_COLOR;
const originalColorTerm = process.env.COLORTERM;

afterEach(() => {
  if (originalNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = originalNoColor;
  if (originalColorTerm === undefined) delete process.env.COLORTERM;
  else process.env.COLORTERM = originalColorTerm;
});

describe("ConversationViewport", () => {
  it("applies each transcript block's semantic kind on the active render path", () => {
    delete process.env.NO_COLOR;
    process.env.COLORTERM = "truecolor";
    const viewport = new ConversationViewport();
    viewport.setTranscriptRenderer(() => [{ heading: "**System**", content: "Gateway unavailable", kind: "error" }]);

    const output = viewport.render(80).join("\n");

    expect(output).toContain("Gateway unavailable");
    expect(output).toContain("\u001b[38;2;200;106;88m");
  });
});
