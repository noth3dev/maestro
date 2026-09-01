import { z } from "zod";

export interface MaestroConfig {
  databaseUrl: string;
  evidenceDir: string;
  host: string;
  port: number;
  primeAgentVersion: string;
  actorId: string;
  leaseOwnerId: string;
  /** Duration of the startup-only reconciliation-leader lease; never renewed after startup. */
  reconcilerLeaseDurationMs: number;
}

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  MAESTRO_EVIDENCE_DIR: z.string().min(1),
  MAESTRO_HOST: z.string().default("127.0.0.1"),
  MAESTRO_PORT: z.coerce.number().int().min(1).max(65535).default(4310),
  MAESTRO_ALLOW_REMOTE: z.enum(["true", "false"]).default("false"),
  MAESTRO_ACTOR_ID: z.string().min(1).default("maestro-control-plane"),
  MAESTRO_INSTANCE_ID: z.string().min(1).default("local-control-plane"),
  MAESTRO_RECONCILER_LEASE_MS: z.coerce.number().int().positive().default(30_000),
});

export function parseConfig(
  env: Record<string, string | undefined>,
): MaestroConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error("Invalid Maestro configuration", { cause: parsed.error });
  }

  const {
    DATABASE_URL: databaseUrl,
    MAESTRO_EVIDENCE_DIR: evidenceDir,
    MAESTRO_HOST: host,
    MAESTRO_PORT: port,
    MAESTRO_ALLOW_REMOTE: allowRemote,
    MAESTRO_ACTOR_ID: actorId,
    MAESTRO_INSTANCE_ID: leaseOwnerId,
    MAESTRO_RECONCILER_LEASE_MS: reconcilerLeaseDurationMs,
  } = parsed.data;

  if (host !== "127.0.0.1" && host !== "localhost" && allowRemote !== "true") {
    throw new Error("Remote binding requires explicit MAESTRO_ALLOW_REMOTE=true");
  }

  return { databaseUrl, evidenceDir, host, port, primeAgentVersion: "0.8.0", actorId, leaseOwnerId, reconcilerLeaseDurationMs };
}


/** Safe for operational logs; it intentionally omits all database user info and query parameters. */
export function redactConfig(config: MaestroConfig): MaestroConfig {
  return { ...config, databaseUrl: redactDatabaseUrl(config.databaseUrl) };
}

function redactDatabaseUrl(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    return `${url.protocol}//[redacted]@${url.host}${url.pathname}`;
  } catch {
    return "[redacted]";
  }
}
