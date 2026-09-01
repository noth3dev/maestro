import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";

const verifierLength = 64;
/** Maximum accepted bearer-secret UTF-8 size. Larger input is rejected before database or KDF work. */
export const MAX_BEARER_SECRET_BYTES = 1024;
/** A local operator may have at most four non-revoked active credentials. */
export const ACTIVE_CREDENTIAL_CAP = 4;
/** scrypt permits at most two concurrent auth attempts in this process. */
export const SCRYPT_CONCURRENCY_LIMIT = 2;

export interface OperatorContext {
  operatorId: string;
  credentialId: string;
}

export type OperatorAuthentication =
  | { outcome: "authenticated"; operator: OperatorContext }
  | { outcome: "invalid" }
  | { outcome: "forbidden" }
  | { outcome: "unavailable" };

export interface BootstrapLocalOperatorInput {
  secret: string;
  operatorId?: string;
  credentialId?: string;
}

export interface CreateLocalOperatorCredentialInput {
  operatorId: string;
  secret: string;
  credentialId?: string;
}

export interface CredentialCreationOptions {
  deriveVerifier?: (secret: string, salt: Buffer) => Promise<Buffer>;
}

export class ActiveCredentialLimitError extends Error {
  constructor() {
    super(`An operator may have at most ${ACTIVE_CREDENTIAL_CAP} active credentials`);
  }
}

export class ScryptConcurrencyGuard {
  private active = 0;

  constructor(private readonly limit = SCRYPT_CONCURRENCY_LIMIT) {}

  tryAcquire(): (() => void) | undefined {
    if (this.active >= this.limit) return undefined;
    this.active += 1;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.active -= 1;
      }
    };
  }
}

const processScryptGuard = new ScryptConcurrencyGuard();

export interface LocalOperatorAuthenticationOptions {
  scryptGuard?: ScryptConcurrencyGuard;
  deriveVerifier?: (secret: string, salt: Buffer) => Promise<Buffer>;
}

/** Controlled setup only. It persists a verifier, never the supplied bearer secret. */
export async function bootstrapLocalOperator(
  pool: Pool,
  input: BootstrapLocalOperatorInput,
  options: CredentialCreationOptions = {},
): Promise<OperatorContext> {
  const operatorId = input.operatorId ?? randomUUID();
  const credentialId = input.credentialId ?? randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO local_operators (operator_id) VALUES ($1)", [operatorId]);
    await createCredential(client, { operatorId, credentialId, secret: input.secret }, options);
    await client.query("COMMIT");
    return { operatorId, credentialId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Create a replacement credential; verifier material on existing credentials is immutable. */
export async function createLocalOperatorCredential(
  pool: Pool,
  input: CreateLocalOperatorCredentialInput,
  options: CredentialCreationOptions = {},
): Promise<OperatorContext> {
  const credentialId = input.credentialId ?? randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await createCredential(client, { ...input, credentialId }, options);
    await client.query("COMMIT");
    return { operatorId: input.operatorId, credentialId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function createCredential(
  client: PoolClient,
  input: Required<CreateLocalOperatorCredentialInput>,
  options: CredentialCreationOptions,
): Promise<void> {
  // Serialize credential creation per operator so the cap cannot be bypassed by concurrent local requests.
  const operator = await client.query("SELECT operator_id FROM local_operators WHERE operator_id = $1 FOR UPDATE", [input.operatorId]);
  if (operator.rowCount !== 1) throw new Error("Local operator does not exist");
  const count = await client.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM local_operator_credentials WHERE operator_id = $1 AND active = true AND revoked_at IS NULL",
    [input.operatorId],
  );
  if (count.rows[0]!.count >= ACTIVE_CREDENTIAL_CAP) throw new ActiveCredentialLimitError();
  const salt = randomBytes(16);
  const verifier = await (options.deriveVerifier ?? deriveVerifier)(input.secret, salt);
  await client.query(
    "INSERT INTO local_operator_credentials (credential_id, operator_id, salt, verifier) VALUES ($1, $2, $3, $4)",
    [input.credentialId, input.operatorId, salt, verifier],
  );
}

export async function authenticateLocalOperator(
  pool: Pool,
  secret: string,
  options: LocalOperatorAuthenticationOptions = {},
): Promise<OperatorAuthentication> {
  if (Buffer.byteLength(secret, "utf8") > MAX_BEARER_SECRET_BYTES) return { outcome: "invalid" };
  const release = (options.scryptGuard ?? processScryptGuard).tryAcquire();
  if (!release) return { outcome: "unavailable" };
  try {
    const result = await pool.query<{
      operator_id: string;
      credential_id: string;
      operator_active: boolean;
      credential_active: boolean;
      revoked_at: Date | null;
      salt: Buffer;
      verifier: Buffer;
    }>(
      `SELECT c.operator_id, c.credential_id, o.active AS operator_active,
              c.active AS credential_active, c.revoked_at, c.salt, c.verifier
       FROM local_operator_credentials c
       JOIN local_operators o ON o.operator_id = c.operator_id`,
    );

    let forbidden = false;
    const derive = options.deriveVerifier ?? deriveVerifier;
    for (const row of result.rows) {
      const verifier = await derive(secret, row.salt);
      if (!timingSafeEqual(verifier, row.verifier)) continue;
      if (!row.operator_active || !row.credential_active || row.revoked_at !== null) {
        forbidden = true;
        continue;
      }
      return { outcome: "authenticated", operator: { operatorId: row.operator_id, credentialId: row.credential_id } };
    }
    return forbidden ? { outcome: "forbidden" } : { outcome: "invalid" };
  } finally {
    release();
  }
}

async function deriveVerifier(secret: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(secret, salt, verifierLength, { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}
