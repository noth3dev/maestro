import type { ApiClient, ProviderAccountLoginStatus } from "@maestro/api-client";

export interface AccountLoginPollingOptions {
  client: Pick<ApiClient, "accountLoginStatus">;
  loginId: string;
  authUrl: string;
  signal: AbortSignal;
  openExternalUrl: (url: string) => Promise<void>;
  onOpenFailure: (url: string) => void;
  timeoutMs: number;
  pollMs: number;
}

/** Open and poll a provider account-login session without owning TUI state. */
export async function waitForAccountLogin(options: AccountLoginPollingOptions): Promise<ProviderAccountLoginStatus | undefined> {
  if (options.signal.aborted) return undefined;
  try {
    await options.openExternalUrl(options.authUrl);
  } catch {
    options.onOpenFailure(options.authUrl);
  }
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 120000;
  const pollMs = Number.isFinite(options.pollMs) && options.pollMs >= 0 ? options.pollMs : 500;
  const deadline = Date.now() + timeoutMs;
  let status = await options.client.accountLoginStatus(options.loginId);
  while (status.state === "pending" && Date.now() < deadline && !options.signal.aborted) {
    await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
    status = await options.client.accountLoginStatus(options.loginId);
  }
  if (options.signal.aborted) return undefined;
  return status;
}
