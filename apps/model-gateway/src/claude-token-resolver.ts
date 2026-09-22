import type { CredentialStore } from "./credential-store.js";

export interface StoredClaudeTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly accountId?: string;
}

const EXPIRY_BUFFER_MS = 60_000;

/**
 * Reads the stored Anthropic (Claude Pro/Max) OAuth token pair for one
 * operator's account and transparently refreshes it when it is at or past
 * expiry, re-persisting the refreshed pair so later calls in the same or a
 * later process reuse it. Mirrors `createCodexAccessTokenResolver` exactly;
 * Claude's OAuth flow simply has no `accountId` concept, so it is carried as
 * an optional passthrough field instead of a required one.
 */
export function createClaudeAccessTokenResolver(options: {
  readonly credentials: Pick<CredentialStore, "resolveForGateway" | "bind">;
  readonly operatorId: string;
  readonly refresh: (refreshToken: string) => Promise<StoredClaudeTokens>;
  readonly now?: () => number;
}): (accountRef: string) => Promise<{ accessToken: string; accountId?: string }> {
  const now = options.now ?? (() => Date.now());
  // Refresh tokens commonly rotate on use (this resolver's own refresh calls
  // do), so two concurrent resolutions for the same account must share one
  // in-flight resolution instead of racing. The registration below happens
  // synchronously, before any `await`, so a second call arriving while the
  // first is still in its microtask queue reliably observes the flight.
  const flights = new Map<string, Promise<{ accessToken: string; accountId?: string }>>();
  return (accountRef: string): Promise<{ accessToken: string; accountId?: string }> => {
    const existing = flights.get(accountRef);
    if (existing !== undefined) return existing;
    const flight = (async () => {
      const secret = await options.credentials.resolveForGateway(accountRef);
      let stored: StoredClaudeTokens;
      try {
        stored = JSON.parse(secret) as StoredClaudeTokens;
      } catch {
        throw new Error("stored Claude credential is malformed");
      }
      if (typeof stored.accessToken !== "string" || typeof stored.refreshToken !== "string" || typeof stored.expiresAt !== "number")
        throw new Error("stored Claude credential is missing required fields");
      if (now() < stored.expiresAt - EXPIRY_BUFFER_MS)
        return { accessToken: stored.accessToken, ...(stored.accountId === undefined ? {} : { accountId: stored.accountId }) };
      const refreshed = await options.refresh(stored.refreshToken);
      await options.credentials.bind(
        { operatorId: options.operatorId, providerId: "anthropic-claude", authMode: "managed-subscription", accountRef },
        JSON.stringify(refreshed),
      );
      return { accessToken: refreshed.accessToken, ...(refreshed.accountId === undefined ? {} : { accountId: refreshed.accountId }) };
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
