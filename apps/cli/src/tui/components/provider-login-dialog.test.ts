import { describe, expect, it } from "vitest";
import { renderProviderLoginDialog } from "./provider-login-dialog.js";

describe("provider login dialog", () => {
  it("shows a selectable Codex account and an explicitly blocked Anthropic subscription", () => {
    const rendered = renderProviderLoginDialog(120, 0, "selecting").join("\n");
    expect(rendered).toContain("ChatGPT Plus / Pro");
    expect(rendered).toContain("OpenAI Codex account");
    expect(rendered).toContain("Claude Pro / Max");
    expect(rendered).toContain("provider approval required");
    expect(rendered).toContain("Enter continue");
  });
  it("keeps full-dialog text and ANSI sequences intact at narrow color widths", () => {
    const ansiEscapePattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
    for (const width of [40, 80]) {
      const rendered = renderProviderLoginDialog(width, 0, "selecting");
      const plain = rendered.map((line) => line.replace(ansiEscapePattern, ""));

      const readable = plain.join(" ").replace(/\s+/g, " ");
      expect(readable).toContain("OpenAI Codex account");
      expect(readable).toContain("provider approval required");
      expect(readable).toContain("↑/↓ choose · Enter continue · Esc cancel");
      expect(plain.every((line) => line.length <= width)).toBe(true);
      expect(plain.some((line) => line.includes("\u001b["))).toBe(false);
    }
  });

  it("keeps waiting-state copy actions visible at a narrow width", () => {
    const ansiEscapePattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
    const rendered = renderProviderLoginDialog(40, 0, "waiting", "https://auth.example/login");
    const plain = rendered.map((line) => line.replace(ansiEscapePattern, ""));
    const readable = plain.join(" ").replace(/\s+/g, " ");

    expect(readable).toContain("Alt+C copy link");
    expect(readable).toContain("Esc cancels");
    expect(plain.every((line) => line.length <= 40)).toBe(true);
    expect(plain.some((line) => line.includes("\u001b["))).toBe(false);
  });

  it("shows a compact chooser with visible controls at supported narrow heights", () => {
    const ansiEscapePattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
    for (const width of [40, 80]) {
      const lines = renderProviderLoginDialog(width, 0, "selecting", undefined, true).map((line) => line.replace(ansiEscapePattern, ""));
      expect(lines).toEqual([
        "Sign in to Maestro",
        "› ChatGPT Plus / Pro",
        "  Claude Pro / Max (unavailable)",
        "↑/↓ choose · Enter continue · Esc cancel",
      ]);
      expect(lines.every((line) => line.length <= width)).toBe(true);
    }

    const anthropic = renderProviderLoginDialog(40, 1, "selecting", undefined, true).map((line) => line.replace(ansiEscapePattern, ""));
    expect(anthropic[1]).toBe("› Claude Pro / Max (unavailable)");
    expect(anthropic[2]).toBe("  ChatGPT Plus / Pro");
  });

  it("shows the login URL and copy shortcut while waiting", () => {
    const rendered = renderProviderLoginDialog(180, 0, "waiting", "https://auth.openai.com/oauth/authorize?state=test").join("\n");
    expect(rendered).toContain("https://auth.openai.com/oauth/authorize?state=test");
    expect(rendered).toContain("Alt+C copy link");
  });
});
