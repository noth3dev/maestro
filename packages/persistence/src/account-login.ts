import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export type AccountLoginState = "starting" | "pending" | "succeeded" | "failed" | "cancelled" | "unknown";
export type AccountLoginTerminalState = Exclude<AccountLoginState, "starting" | "pending">;

export interface AccountLoginRecord {
  readonly loginId: string;
  readonly requestId: string;
  readonly operatorId: string;
  readonly ownerId: string;
  readonly providerId: "openai-codex";
  readonly providerLoginId: string | null;
  readonly authUrl: string | null;
  readonly state: AccountLoginState;
  readonly message: string | null;
}

export interface AccountLoginReservation {
  readonly created: boolean;
  readonly record: AccountLoginRecord;
}

export class AccountLoginConflictError extends Error {
  constructor() {
    super("Provider account login request was already used with different content");
    this.name = "AccountLoginConflictError";
  }
}

export interface AccountLoginStore {
  reserveStart(operatorId: string, requestId: string, providerId: "openai-codex", ownerId: string): Promise<AccountLoginReservation>;
  completeStart(loginId: string, providerLoginId: string, authUrl: string): Promise<AccountLoginRecord>;
  failStart(loginId: string, message: string): Promise<AccountLoginRecord>;
  get(loginId: string, operatorId: string): Promise<AccountLoginRecord | undefined>;
  getByRequest(operatorId: string, requestId: string): Promise<AccountLoginRecord | undefined>;
  updateState(loginId: string, operatorId: string, state: AccountLoginState, message?: string, operationOwnerId?: string, operationToken?: string): Promise<AccountLoginRecord>;
  claimOperation(loginId: string, operatorId: string, operation: "status" | "cancel", ownerId: string, staleAfterMs: number): Promise<string | undefined>;
  releaseOperation(loginId: string, operatorId: string, ownerId: string, operationToken: string): Promise<void>;
  recoverStarting(ownerId: string): Promise<number>;
}

type LoginRow = {
  login_id: string;
  request_id: string;
  operator_id: string;
  owner_id: string;
  provider_id: "openai-codex";
  provider_login_id: string | null;
  auth_url: string | null;
  state: AccountLoginState;
  message: string | null;
};

const columns = "login_id, request_id, operator_id, owner_id, provider_id, provider_login_id, auth_url, state, message";
const allowedAuthHosts = new Set(["chatgpt.com", "auth.openai.com"]);

function assertProvider(providerId: string): asserts providerId is "openai-codex" {
  if (providerId !== "openai-codex") throw new Error("account login provider is unavailable");
}

function assertAuthUrl(authUrl: string): void {
  let parsed: URL;
  try { parsed = new URL(authUrl); } catch { throw new Error("provider account login returned an invalid URL"); }
  if (parsed.protocol !== "https:" || !allowedAuthHosts.has(parsed.hostname) || parsed.username !== "" || parsed.password !== "") throw new Error("provider account login returned an invalid URL");
}

function map(row: LoginRow): AccountLoginRecord {
  return { loginId: row.login_id, requestId: row.request_id, operatorId: row.operator_id, ownerId: row.owner_id, providerId: row.provider_id, providerLoginId: row.provider_login_id, authUrl: row.auth_url, state: row.state, message: row.message };
}

export function createPostgresAccountLoginStore(pool: Pool): AccountLoginStore {
  return {
    async reserveStart(operatorId, requestId, providerId, ownerId) {
      assertProvider(providerId);
      if (operatorId.trim() === "" || requestId.trim() === "" || requestId.length > 256 || ownerId.trim() === "" || ownerId.length > 256) throw new Error("account login request metadata is invalid");
      const inserted = await pool.query<LoginRow>(
        `INSERT INTO provider_account_login_sessions (login_id, request_id, operator_id, owner_id, provider_id, state)
         VALUES ($1, $2, $3, $4, $5, 'starting')
         ON CONFLICT (operator_id, request_id) DO NOTHING
         RETURNING ${columns}`,
        [randomUUID(), requestId, operatorId, ownerId, providerId],
      );
      if (inserted.rowCount === 1) return { created: true, record: map(inserted.rows[0]!) };
      const existing = await pool.query<LoginRow>(`SELECT ${columns} FROM provider_account_login_sessions WHERE operator_id = $1 AND request_id = $2`, [operatorId, requestId]);
      if (existing.rowCount !== 1) throw new Error("account login idempotency record disappeared");
      const record = map(existing.rows[0]!);
      if (record.providerId !== providerId) throw new AccountLoginConflictError();
      return { created: false, record };
    },

    async completeStart(loginId, providerLoginId, authUrl) {
      if (providerLoginId.trim() === "" || providerLoginId.length > 256) throw new Error("provider account login returned invalid metadata");
      assertAuthUrl(authUrl);
      const result = await pool.query<LoginRow>(
        `UPDATE provider_account_login_sessions
            SET provider_login_id = $2, auth_url = $3, state = 'pending', message = NULL
          WHERE login_id = $1 AND state = 'starting'
          RETURNING ${columns}`,
        [loginId, providerLoginId, authUrl],
      );
      if (result.rowCount === 1) return map(result.rows[0]!);
      const existing = await pool.query<LoginRow>(`SELECT ${columns} FROM provider_account_login_sessions WHERE login_id = $1`, [loginId]);
      if (existing.rowCount !== 1) throw new Error("account login idempotency record disappeared");
      const record = map(existing.rows[0]!);
      if (record.providerLoginId !== providerLoginId || record.authUrl !== authUrl) throw new AccountLoginConflictError();
      return record;
    },

    async failStart(loginId, message) {
      const safeMessage = message.trim().slice(0, 512) || "Provider account login failed";
      const result = await pool.query<LoginRow>(`UPDATE provider_account_login_sessions SET state = 'failed', message = $2 WHERE login_id = $1 AND state = 'starting' RETURNING ${columns}`, [loginId, safeMessage]);
      if (result.rowCount === 1) return map(result.rows[0]!);
      const existing = await pool.query<LoginRow>(`SELECT ${columns} FROM provider_account_login_sessions WHERE login_id = $1`, [loginId]);
      if (existing.rowCount !== 1) throw new Error("account login idempotency record disappeared");
      return map(existing.rows[0]!);
    },

    async get(loginId, operatorId) {
      const result = await pool.query<LoginRow>(`SELECT ${columns} FROM provider_account_login_sessions WHERE login_id = $1 AND operator_id = $2`, [loginId, operatorId]);
      return result.rowCount === 1 ? map(result.rows[0]!) : undefined;
    },

    async getByRequest(operatorId, requestId) {
      const result = await pool.query<LoginRow>(`SELECT ${columns} FROM provider_account_login_sessions WHERE operator_id = $1 AND request_id = $2`, [operatorId, requestId]);
      return result.rowCount === 1 ? map(result.rows[0]!) : undefined;
    },

    async updateState(loginId, operatorId, state, message, operationOwnerId, operationToken) {
      const existing = await this.get(loginId, operatorId);
      if (existing === undefined) throw new Error("account login session is unknown");
      if (existing.state === "succeeded" || existing.state === "failed" || existing.state === "cancelled" || existing.state === "unknown") return existing;
      const safeMessage = message?.trim().slice(0, 512) || null;
      try {
        const result = await pool.query<LoginRow>(`UPDATE provider_account_login_sessions
            SET state = $3, message = $4, operation = NULL, operation_owner = NULL, operation_token = NULL, operation_started_at = NULL
          WHERE login_id = $1 AND operator_id = $2 AND ($5::text IS NULL OR (operation_owner = $5 AND operation_token = $6) OR operation_owner IS NULL)
          RETURNING ${columns}`, [loginId, operatorId, state, safeMessage, operationOwnerId ?? null, operationToken ?? null]);
        if (result.rowCount === 1) return map(result.rows[0]!);
      } catch (error) {
        const raced = await this.get(loginId, operatorId);
        if (raced !== undefined && (raced.state === "succeeded" || raced.state === "failed" || raced.state === "cancelled" || raced.state === "unknown")) return raced;
        throw error;
      }
      const reread = await this.get(loginId, operatorId);
      if (reread === undefined) throw new Error("account login session is unknown");
      return reread;
    },

    async claimOperation(loginId, operatorId, operation, ownerId, staleAfterMs) {
      if (ownerId.trim() === "" || ownerId.length > 256 || !Number.isInteger(staleAfterMs) || staleAfterMs <= 0 || staleAfterMs > 3_600_000) throw new Error("account login operation metadata is invalid");
      const operationToken = randomUUID();
      const result = await pool.query<{ operation_token: string }>(
        `UPDATE provider_account_login_sessions
            SET operation = $3, operation_owner = $4, operation_token = $5, operation_started_at = transaction_timestamp()
          WHERE login_id = $1 AND operator_id = $2 AND state = 'pending'
            AND (operation IS NULL OR operation_started_at < transaction_timestamp() - ($6 * interval '1 millisecond'))
          RETURNING operation_token`,
        [loginId, operatorId, operation, ownerId, operationToken, staleAfterMs],
      );
      return result.rowCount === 1 ? result.rows[0]!.operation_token : undefined;
    },

    async releaseOperation(loginId, operatorId, ownerId, operationToken) {
      if (ownerId.trim() === "" || ownerId.length > 256 || operationToken.trim() === "") throw new Error("account login operation metadata is invalid");
      await pool.query(
        `UPDATE provider_account_login_sessions
            SET operation = NULL, operation_owner = NULL, operation_token = NULL, operation_started_at = NULL
          WHERE login_id = $1 AND operator_id = $2 AND operation_owner = $3 AND operation_token = $4`,
        [loginId, operatorId, ownerId, operationToken],
      );
    },

    async recoverStarting(ownerId) {
      if (ownerId.trim() === "" || ownerId.length > 256) throw new Error("account login owner metadata is invalid");
      const result = await pool.query(
        `UPDATE provider_account_login_sessions
            SET state = 'unknown', message = 'Provider login was interrupted during Control Plane restart', operation = NULL, operation_owner = NULL, operation_token = NULL, operation_started_at = NULL
          WHERE state = 'starting' AND owner_id <> $1`,
        [ownerId],
      );
      return result.rowCount ?? 0;
    },
  };
}
