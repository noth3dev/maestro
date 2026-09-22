import { openExternalUrl } from "../external-url.js";
import type { CliIo } from "../main.js";
import type { CommandCtx } from "./ctx.js";
import { printState } from "./ctx.js";

export async function runAuthCommands(ctx: CommandCtx, resource: string | undefined, action: string | undefined): Promise<boolean> {
  if (resource === "login" && action === "openai-codex") {
    const login = await ctx.client.startAccountLogin("openai-codex");
    if (!ctx.json) ctx.io.stdout(`Opening ChatGPT account login in your browser: ${login.authUrl}\n`);
    try { await (ctx.io.openExternalUrl ?? openExternalUrl)(login.authUrl); } catch { if (!ctx.json) ctx.io.stdout(`If the browser did not open, visit: ${login.authUrl}\n`); }
    const timeoutMs = Number(ctx.env.MAESTRO_LOGIN_TIMEOUT_MS ?? "120000");
    const pollMs = Number(ctx.env.MAESTRO_LOGIN_POLL_MS ?? "500");
    const deadline = Date.now() + (Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120_000);
    let status = await ctx.client.accountLoginStatus("openai-codex", login.loginId);
    while (status.state === "pending" && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, Number.isFinite(pollMs) && pollMs >= 0 ? pollMs : 500));
      status = await ctx.client.accountLoginStatus("openai-codex", login.loginId);
    }
    if (status.state === "succeeded") { if (!ctx.json) ctx.io.stdout(`Account login complete: ${login.providerId}\n`); printState(ctx.io.stdout, { providerId: login.providerId, loginId: login.loginId, state: status.state }, ctx.json); return true; }
    if (status.state === "pending") throw new Error("Provider account login timed out");
    throw new Error(status.message ?? `Provider account login ${status.state}`);
  }

  if (resource === "login" && (action === "openai" || action === "anthropic")) {
    const secret = await (ctx.io.readSecret ?? ((prompt) => readSecretFromStdin(ctx.io, prompt)))(`${action} API key`);
    const result = await ctx.client.loginProvider({ providerId: action, authMode: "api-key", secret });
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "logout" && action === "openai-codex") {
    await ctx.client.logoutAccount("openai-codex");
    printState(ctx.io.stdout, { providerId: action, revoked: true }, ctx.json);
    return true;
  }

  if (resource === "logout" && (action === "openai" || action === "anthropic")) {
    await ctx.client.logoutProvider(action);
    printState(ctx.io.stdout, { providerId: action, revoked: true }, ctx.json);
    return true;
  }
  return false;
}

async function readSecretFromStdin(io: CliIo, prompt: string): Promise<string> {
  io.stderr(`${prompt}: `);
  const stdin = process.stdin;
  if (!stdin.isTTY || stdin.setRawMode === undefined) {
    const chunks: Buffer[] = [];
    for await (const chunk of stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    const secret = Buffer.concat(chunks).toString("utf8").split(/\r?\n/, 1)[0] ?? "";
    if (secret.trim() === "") throw new Error("A non-empty provider API key is required");
    return secret.trim();
  }
  return await new Promise<string>((resolve, reject) => {
    let secret = "";
    const cleanup = (): void => {
      stdin.off("data", onData);
      stdin.setRawMode?.(false);
      stdin.pause();
      io.stderr("\n");
    };
    const onData = (chunk: Buffer | string): void => {
      for (const char of String(chunk)) {
        if (char === "") { cleanup(); reject(new Error("Provider login cancelled")); return; }
        if (char === "\r" || char === "\n") {
          cleanup();
          if (secret.trim() === "") reject(new Error("A non-empty provider API key is required"));
          else resolve(secret.trim());
          return;
        }
        if (char === "" || char === "\b") secret = secret.slice(0, -1);
        else secret += char;
      }
    };
    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}
