import { describe, expect, it, vi } from "vitest";
import { isProviderAuthUrlAllowed, waitForProviderAccountLogin } from "./provider-account-login.js";

describe("provider account login", () => {
  it("accepts only HTTPS URLs from OpenAI authentication hosts", () => {
    expect(isProviderAuthUrlAllowed("https://auth.openai.com/oauth/authorize")).toBe(true);
    expect(isProviderAuthUrlAllowed("https://chatgpt.com/backend-api/auth")).toBe(true);
    expect(isProviderAuthUrlAllowed("https://login.chatgpt.com/backend-api/auth")).toBe(false);
    expect(isProviderAuthUrlAllowed("http://auth.openai.com/oauth/authorize")).toBe(false);
    expect(isProviderAuthUrlAllowed("https://example.com/redirect")).toBe(false);
  });

  it("keeps polling until the provider login succeeds", async () => {
    const readStatus = vi
      .fn()
      .mockResolvedValueOnce({ providerId: "openai-codex" as const, loginId: "login-1", state: "pending" as const })
      .mockResolvedValueOnce({ providerId: "openai-codex" as const, loginId: "login-1", state: "succeeded" as const });

    await expect(waitForProviderAccountLogin(readStatus, "login-1", { intervalMs: 0, maxAttempts: 3 })).resolves.toMatchObject({ state: "succeeded" });
    expect(readStatus).toHaveBeenCalledTimes(2);
  });

  it("returns a terminal failure without polling again", async () => {
    const readStatus = vi.fn().mockResolvedValue({ providerId: "openai-codex" as const, loginId: "login-1", state: "failed" as const, message: "Browser login failed" });

    await expect(waitForProviderAccountLogin(readStatus, "login-1", { intervalMs: 0, maxAttempts: 3 })).rejects.toThrow("Browser login failed");
    expect(readStatus).toHaveBeenCalledTimes(1);
  });
});
