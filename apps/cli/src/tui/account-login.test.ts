import { describe, expect, it, vi } from "vitest";
import { waitForAccountLogin } from "./account-login.js";

describe("account login polling boundary", () => {
  it("opens the supplied URL and returns the terminal login status", async () => {
    const statuses = [
      { providerId: "openai-codex" as const, state: "pending" as const, loginId: "login-1" },
      { providerId: "openai-codex" as const, state: "succeeded" as const, loginId: "login-1" },
    ];
    const accountLoginStatus = vi.fn(async () => statuses.shift()!);
    const openExternalUrl = vi.fn(async () => undefined);
    const onOpenFailure = vi.fn();

    await expect(
      waitForAccountLogin({
        client: { accountLoginStatus },
        loginId: "login-1",
        authUrl: "https://auth.example.test/login-1",
        signal: new AbortController().signal,
        openExternalUrl,
        onOpenFailure,
        timeoutMs: 100,
        pollMs: 0,
      }),
    ).resolves.toEqual({ providerId: "openai-codex", state: "succeeded", loginId: "login-1" });

    expect(openExternalUrl).toHaveBeenCalledWith("https://auth.example.test/login-1");
    expect(accountLoginStatus).toHaveBeenCalledTimes(2);
    expect(onOpenFailure).not.toHaveBeenCalled();
  });
});
