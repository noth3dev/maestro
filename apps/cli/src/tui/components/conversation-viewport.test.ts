import { afterEach, describe, expect, it } from "vitest";
import { ConversationViewport } from "./conversation-viewport.js";

const originalNoColor = process.env.NO_COLOR;
const originalColorTerm = process.env.COLORTERM;
const ansiEscapePattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const stripAnsi = (value: string): string => value.replace(ansiEscapePattern, "");

afterEach(() => {
  if (originalNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = originalNoColor;
  if (originalColorTerm === undefined) delete process.env.COLORTERM;
  else process.env.COLORTERM = originalColorTerm;
});

describe("ConversationViewport", () => {
  it("renders ordered conversation entries through Markdown", () => {
    const viewport = new ConversationViewport();
    viewport.setOrderedStreamRenderer(() => [{
      occurredAt: "2026-01-01T00:00:00.000Z",
      stable: "conversation:event-1:1",
      content: { heading: "**Maestro**", content: "Use **bold** safely", kind: "success" },
    }]);

    const output = stripAnsi(viewport.render(80).join("\n"));

    expect(output).toContain("Use bold safely");
    expect(output).not.toContain("**bold**");
    expect(output).toContain("✓");
  });

  it("keeps semantic glyphs visible for coloured transcript states", () => {
    const viewport = new ConversationViewport();
    viewport.setTranscriptRenderer(() => [{ heading: "**System**", content: "Denied", kind: "error" }]);

    expect(viewport.render(80).join("\n")).toContain("✗");
  });

  it("keeps activity events in the same scrollable stream as conversation", () => {
    const viewport = new ConversationViewport();
    viewport.setTranscriptRenderer(() => [{ heading: "you", content: "inspect status", kind: "text" }]);
    viewport.setStreamRenderer(() => ["◆ Council convened", "✓ certification issued"]);

    const output = viewport.render(80).join("\n");

    expect(output.indexOf("inspect status")).toBeLessThan(output.indexOf("Council convened"));
    expect(output).toContain("certification issued");
  });

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
