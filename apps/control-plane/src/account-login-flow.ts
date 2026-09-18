import type { AccountLoginRecord, AccountLoginStore } from "@maestro/persistence";
import type { GatewayAccountLoginStatusResult } from "@maestro/agent-runtime";
import { ModelGatewayClientError } from "./model-gateway-client.js";

export interface AccountLoginFlowDeps {
  readonly store: AccountLoginStore;
  readonly ownerId: string;
  readonly staleAfterMs: number;
}

export interface AccountLoginIdentity {
  readonly operatorId: string;
  readonly loginId: string;
  readonly providerId: "openai-codex";
  readonly requestId: string;
}

export function isLostGatewayLogin(error: unknown): boolean {
  return error instanceof ModelGatewayClientError && error.code === "account_login_session_unknown";
}

async function loadLoginRecord(store: AccountLoginStore, id: AccountLoginIdentity): Promise<AccountLoginRecord> {
  const record = await store.get(id.loginId, id.operatorId);
  if (record === undefined || record.providerId !== id.providerId) throw new Error("account login session is unknown");
  return record;
}

/** A record past the pending/providerLoginId gate: safe to call the gateway with. */
export interface ReadyLoginRecord extends AccountLoginRecord {
  readonly providerLoginId: string;
}

/**
 * Shared claim/409-release skeleton for status and cancel. The record is
 * already loaded (and starting already handled by status); this claims the
 * operation, re-reads on contention, runs the gateway call, and always
 * releases. Response mapping stays in routes.
 */
export async function withLoginOperation<T>(args: {
  deps: AccountLoginFlowDeps;
  id: AccountLoginIdentity;
  record: AccountLoginRecord;
  operation: "status" | "cancel";
  settled: (record: AccountLoginRecord) => T;
  contended: () => T;
  run: (record: ReadyLoginRecord, operationToken: string) => Promise<T>;
}): Promise<T> {
  const { store } = args.deps;
  if (args.record.state !== "pending" || args.record.providerLoginId === null) return args.settled(args.record);
  // Copy the narrowed fields: property narrowing does not survive awaits.
  const ready: ReadyLoginRecord = { ...args.record, providerLoginId: args.record.providerLoginId };
  const operationToken = await store.claimOperation(
    ready.loginId,
    args.id.operatorId,
    args.operation,
    args.deps.ownerId,
    args.deps.staleAfterMs,
  );
  if (operationToken === undefined) {
    const current = await store.get(ready.loginId, args.id.operatorId);
    if (current === undefined) throw new Error("account login session is unknown");
    if (current.state !== "pending" || current.providerLoginId === null) return args.settled(current);
    return args.contended();
  }
  try {
    return await args.run(ready, operationToken);
  } finally {
    await store.releaseOperation(ready.loginId, args.id.operatorId, args.deps.ownerId, operationToken).catch(() => undefined);
  }
}

export type PollAccountLoginStatusResult =
  | { kind: "starting" }
  | { kind: "echo"; record: AccountLoginRecord }
  | { kind: "contended" }
  | { kind: "updated"; record: AccountLoginRecord };

export async function pollAccountLoginStatus(
  deps: AccountLoginFlowDeps,
  gateway: {
    accountLoginStatus: (input: { operatorId: string; requestId: string; providerId: "openai-codex"; loginId: string }) => Promise<GatewayAccountLoginStatusResult>;
  },
  id: AccountLoginIdentity,
): Promise<PollAccountLoginStatusResult> {
  const record = await loadLoginRecord(deps.store, id);
  if (record.state === "starting") return { kind: "starting" };
  return withLoginOperation<PollAccountLoginStatusResult>({
    deps,
    id,
    record,
    operation: "status",
    settled: (settledRecord) => ({ kind: "echo", record: settledRecord }) as const,
    contended: () => ({ kind: "contended" }) as const,
    run: async (ready, operationToken) => {
      let result: GatewayAccountLoginStatusResult;
      try {
        result = await gateway.accountLoginStatus({
          operatorId: id.operatorId,
          requestId: id.requestId,
          providerId: id.providerId,
          loginId: ready.providerLoginId,
        });
      } catch (error) {
        if (!isLostGatewayLogin(error)) throw error;
        const unknown = await deps.store.updateState(
          ready.loginId,
          id.operatorId,
          "unknown",
          "Gateway login session was lost during restart",
          deps.ownerId,
          operationToken,
        );
        return { kind: "updated", record: unknown } as const;
      }
      const updated = await deps.store.updateState(
        ready.loginId,
        id.operatorId,
        result.state,
        result.message,
        deps.ownerId,
        operationToken,
      );
      return { kind: "updated", record: updated } as const;
    },
  });
}

export type CancelAccountLoginResult =
  | { kind: "echo"; record: AccountLoginRecord }
  | { kind: "contended" }
  | { kind: "cancelled" }
  | { kind: "unknown" };

export async function cancelAccountLoginFlow(
  deps: AccountLoginFlowDeps,
  gateway: {
    cancelAccountLogin: (input: { operatorId: string; requestId: string; providerId: "openai-codex"; loginId: string }) => Promise<void>;
  },
  id: AccountLoginIdentity,
): Promise<CancelAccountLoginResult> {
  const record = await loadLoginRecord(deps.store, id);
  return withLoginOperation<CancelAccountLoginResult>({
    deps,
    id,
    record,
    operation: "cancel",
    settled: (settledRecord) => ({ kind: "echo", record: settledRecord }) as const,
    contended: () => ({ kind: "contended" }) as const,
    run: async (ready, operationToken) => {
      try {
        await gateway.cancelAccountLogin({
          operatorId: id.operatorId,
          requestId: id.requestId,
          providerId: id.providerId,
          loginId: ready.providerLoginId,
        });
        await deps.store.updateState(ready.loginId, id.operatorId, "cancelled", undefined, deps.ownerId, operationToken);
      } catch (error) {
        if (!isLostGatewayLogin(error)) throw error;
        await deps.store.updateState(
          ready.loginId,
          id.operatorId,
          "unknown",
          "Gateway login session was lost during restart",
          deps.ownerId,
          operationToken,
        );
        return { kind: "unknown" } as const;
      }
      return { kind: "cancelled" } as const;
    },
  });
}
