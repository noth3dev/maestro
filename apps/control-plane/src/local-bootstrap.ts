import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  bootstrapLocalOperator,
  bootstrapPermanentOrganization,
  runMigrations,
} from "@maestro/persistence";
import { grantProjectMembership, grantProjectRole } from "@maestro/persistence/testing";

/** Metadata needed by the CLI to construct the one-time bearer envelope. */
export interface LocalBootstrapResult {
  operatorId: string;
  credentialId: string;
  projectId: string;
}

/**
 * Bootstrap only the local operator boundary. The secret is deliberately read
 * from the process environment and is never persisted or logged here; the CLI
 * keeps the resulting bearer token in the OS keychain.
 */
export async function bootstrapLocalOperatorForCli(
  env: Record<string, string | undefined> = process.env,
): Promise<LocalBootstrapResult> {
  const secret = env.MAESTRO_LOCAL_BOOTSTRAP_SECRET;
  if (secret === undefined || secret.trim() === "") throw new Error("MAESTRO_LOCAL_BOOTSTRAP_SECRET is required");
  const pool = new Pool({ connectionString: required(env, "DATABASE_URL") });
  const operatorId = env.MAESTRO_LOCAL_OPERATOR_ID ?? randomUUID();
  const credentialId = env.MAESTRO_LOCAL_CREDENTIAL_ID ?? randomUUID();
  const projectId = env.MAESTRO_LOCAL_PROJECT_ID ?? randomUUID();
  try {
    await runMigrations(pool);
    await bootstrapPermanentOrganization(pool);
    const operator = await bootstrapLocalOperator(pool, { operatorId, credentialId, secret });
    await grantProjectMembership(pool, operator.operatorId, projectId);
    await grantProjectRole(pool, operator.operatorId, projectId, "concertmaster");
    return { operatorId: operator.operatorId, credentialId: operator.credentialId, projectId };
  } finally {
    await pool.end();
  }
}

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") throw new Error(`${name} is required`);
  return value;
}

export async function main(): Promise<void> {
  const result = await bootstrapLocalOperatorForCli();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (import.meta.url === new URL(process.argv[1]!, "file:").href) {
  void main().catch(() => {
    // Never print environment values or database URLs from this credential setup process.
    process.stderr.write("Local Maestro bootstrap failed\n");
    process.exitCode = 1;
  });
}
