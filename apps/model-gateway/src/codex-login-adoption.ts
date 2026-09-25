import type { CodexAppServerClient } from "@maestro/model-provider-openai";
import type { CredentialStore } from "./credential-store.js";

/**
 * The Codex app-server keeps its own ChatGPT login (shared with the Codex
 * CLI). When that login already exists, record the managed binding the
 * gateway would otherwise only create after an in-app sign-in, so a machine
 * that is already signed in to Codex needs no extra Maestro login step.
 * The token itself stays inside the app-server; only the binding is stored.
 */
export async function adoptExistingCodexLogin(options: {
  readonly client: Pick<CodexAppServerClient, "accountRead">;
  readonly credentials: Pick<CredentialStore, "ensure" | "bindManaged">;
  readonly operatorId: string;
  readonly accountRef: string;
}): Promise<boolean> {
  if (options.credentials.bindManaged === undefined) return false;
  try {
    if ((await options.credentials.ensure(options.accountRef)) !== undefined) return false;
    const account = await options.client.accountRead();
    if (account.authMode !== "chatgpt") return false;
    await options.credentials.bindManaged({ operatorId: options.operatorId, providerId: "openai-codex", accountRef: options.accountRef });
    return true;
  } catch {
    // Adoption is a convenience; the explicit in-app sign-in remains available.
    return false;
  }
}
