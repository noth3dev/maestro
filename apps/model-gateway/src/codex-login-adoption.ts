import type { CodexAppServerClient } from "@maestro/model-provider-openai";
import { ManagedCredentialWithoutSecretError, type CredentialStore } from "./credential-store.js";

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

/**
 * On the native Codex path a token-less binding (left by the app-server
 * bridge) would list models that can never run. Remove it so the operator is
 * asked to sign in instead.
 */
export async function retireSecretlessCodexBinding(options: {
  readonly credentials: Pick<CredentialStore, "ensure" | "resolveForGateway" | "revoke">;
  readonly operatorId: string;
  readonly accountRef: string;
}): Promise<boolean> {
  try {
    if ((await options.credentials.ensure(options.accountRef)) === undefined) return false;
    await options.credentials.resolveForGateway(options.accountRef);
    return false;
  } catch (error) {
    if (!(error instanceof ManagedCredentialWithoutSecretError)) return false;
    await options.credentials.revoke(options.accountRef, options.operatorId);
    return true;
  }
}
