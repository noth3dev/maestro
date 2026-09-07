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
  it("shows the login URL and copy shortcut while waiting", () => {
    const rendered = renderProviderLoginDialog(180, 0, "waiting", "https://auth.openai.com/oauth/authorize?state=test").join("\n");
    expect(rendered).toContain("https://auth.openai.com/oauth/authorize?state=test");
    expect(rendered).toContain("Alt+C copy link");
  });

});
