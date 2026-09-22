import type { CredentialStore } from "./credential-store.js";

export interface StoredCodexTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly accountId: string;
}

const EXPIRY_BUFFER_MS = 60_000;

/**
 * Reads the stored ChatGPT Codex OAuth token pair for one operator's account
 * and transparently refreshes it when it is at or past expiry, re-persisting
 * the refreshed pair so later calls in the same or a later process reuse it.
 */
export function createCodexAccessTokenResolver(options: {
  readonly credentials: Pick<CredentialStore, "resolveForGateway" | "bind">;
  readonly operatorId: string;
  readonly refresh: (refreshToken: string) => Promise<StoredCodexTokens>;
  readonly now?: () => number;
}): (accountRef: string) => Promise<{ accessToken: string; accountId: string }> {
  const now = options.now ?? (() => Date.now());
  // Refresh tokens commonly rotate on use (this resolver's own refresh calls
  // do), so two concurrent resolutions for the same account must share one
  // in-flight resolution instead of racing. The registration below happens
  // synchronously, before any `await`, so a second call arriving while the
  // first is still in its microtask queue reliably observes the flight.
  const flights = new Map<string, Promise<{ accessToken: string; accountId: string }>>();
  return (accountRef: string): Promise<{ accessToken: string; accountId: string }> => {
    const existing = flights.get(accountRef);
    if (existing !== undefined) return existing;
    const flight = (async () => {
      const secret = await options.credentials.resolveForGateway(accountRef);
      let stored: StoredCodexTokens;
      try {
        stored = JSON.parse(secret) as StoredCodexTokens;
      } catch {
        throw new Error("stored Codex credential is malformed");
      }
      if (typeof stored.accessToken !== "string" || typeof stored.refreshToken !== "string" || typeof stored.expiresAt !== "number" || typeof stored.accountId !== "string")
        throw new Error("stored Codex credential is missing required fields");
      if (now() < stored.expiresAt - EXPIRY_BUFFER_MS) return { accessToken: stored.accessToken, accountId: stored.accountId };
      const refreshed = await options.refresh(stored.refreshToken);
      await options.credentials.bind({ operatorId: options.operatorId, providerId: "openai-codex", authMode: "managed-subscription", accountRef }, JSON.stringify(refreshed));
      return { accessToken: refreshed.accessToken, accountId: refreshed.accountId };
    })();
    flights.set(accountRef, flight);
    flight
      .finally(() => {
        if (flights.get(accountRef) === flight) flights.delete(accountRef);
      })
      // The cleanup chain's own promise is a separate consumer from the
      // `flight` promise returned below; swallow its rejection here so a
      // failed resolution doesn't also surface as an unhandled rejection —
      // the caller who awaits the returned `flight` still sees the real error.
      .catch(() => undefined);
    return flight;
  };
}
