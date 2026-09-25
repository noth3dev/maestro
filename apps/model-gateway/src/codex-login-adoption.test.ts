import { describe, expect, it, vi } from "vitest";
import { adoptExistingCodexLogin } from "./codex-login-adoption.js";

const binding = { accountRef: "openai-codex-op", operatorId: "op", providerId: "openai-codex", authMode: "managed-subscription" } as const;

function deps(input: { authMode: string; existing?: boolean; readFails?: boolean }) {
  const credentials = {
    ensure: vi.fn(async () => (input.existing === true ? binding : undefined)),
    bindManaged: vi.fn(async () => binding),
  };
  const client = {
    accountRead: vi.fn(async () => {
      if (input.readFails === true) throw new Error("app-server unavailable");
      return { authMode: input.authMode as "chatgpt" };
    }),
  };
  return { credentials, client, operatorId: "op", accountRef: "openai-codex-op" };
}

describe("adoptExistingCodexLogin", () => {
  it("binds an existing ChatGPT login held by the Codex app-server", async () => {
    const options = deps({ authMode: "chatgpt" });
    await expect(adoptExistingCodexLogin(options)).resolves.toBe(true);
    expect(options.credentials.bindManaged).toHaveBeenCalledWith({ operatorId: "op", providerId: "openai-codex", accountRef: "openai-codex-op" });
  });

  it("leaves an existing binding untouched", async () => {
    const options = deps({ authMode: "chatgpt", existing: true });
    await expect(adoptExistingCodexLogin(options)).resolves.toBe(false);
    expect(options.client.accountRead).not.toHaveBeenCalled();
    expect(options.credentials.bindManaged).not.toHaveBeenCalled();
  });

  it.each(["null", "apikey", "unknown"])("does not bind when the app-server auth mode is %s", async (authMode) => {
    const options = deps({ authMode });
    await expect(adoptExistingCodexLogin(options)).resolves.toBe(false);
    expect(options.credentials.bindManaged).not.toHaveBeenCalled();
  });

  it("treats an unavailable app-server as not signed in", async () => {
    const options = deps({ authMode: "chatgpt", readFails: true });
    await expect(adoptExistingCodexLogin(options)).resolves.toBe(false);
    expect(options.credentials.bindManaged).not.toHaveBeenCalled();
  });
});
