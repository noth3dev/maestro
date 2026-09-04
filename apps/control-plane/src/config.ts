import { z } from "zod";

export interface MaestroTlsConfig {
  certFile: string;
  keyFile: string;
}

export interface MaestroConfig {
  databaseUrl: string;
  evidenceDir: string;
  worktreeRoot: string;
  host: string;
  port: number;
  primeAgentVersion: string;
  actorId: string;
  leaseOwnerId: string;
  /** Optional explicit CEO identity; approvals fail closed when absent. */
  ceoOperatorId?: string;
  /** Optional explicit operator allowed to provision project memberships and roles. */
  operatorProvisioningAdminId?: string;
  /** Duration of the startup-only reconciliation-leader lease; never renewed after startup. */
  reconcilerLeaseDurationMs: number;
  /**
   * Only ever set for a non-loopback bind; a remote bind without it is
   * rejected below before this config is ever returned. File paths only --
   * the composition root reads and passes their bytes to the real listener.
   */
  tls?: MaestroTlsConfig;
}

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  MAESTRO_EVIDENCE_DIR: z.string().min(1),
  MAESTRO_WORKTREE_ROOT: z.string().min(1),
  MAESTRO_HOST: z.string().default("127.0.0.1"),
  MAESTRO_PORT: z.coerce.number().int().min(1).max(65535).default(4310),
  MAESTRO_ALLOW_REMOTE: z.enum(["true", "false"]).default("false"),
  MAESTRO_ACTOR_ID: z.string().min(1).default("maestro-control-plane"),
  MAESTRO_CEO_OPERATOR_ID: z.string().min(1).optional(),
  MAESTRO_OPERATOR_PROVISIONING_ADMIN_ID: z.string().uuid().optional(),
  MAESTRO_INSTANCE_ID: z.string().min(1).default("local-control-plane"),
  MAESTRO_RECONCILER_LEASE_MS: z.coerce.number().int().positive().default(30_000),
  MAESTRO_TLS_CERT_FILE: z.string().min(1).optional(),
  MAESTRO_TLS_KEY_FILE: z.string().min(1).optional(),
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
    MAESTRO_WORKTREE_ROOT: worktreeRoot,
    MAESTRO_HOST: host,
    MAESTRO_PORT: port,
    MAESTRO_ALLOW_REMOTE: allowRemote,
    MAESTRO_ACTOR_ID: actorId,
    MAESTRO_CEO_OPERATOR_ID: ceoOperatorId,
    MAESTRO_OPERATOR_PROVISIONING_ADMIN_ID: operatorProvisioningAdminId,
    MAESTRO_INSTANCE_ID: leaseOwnerId,
    MAESTRO_RECONCILER_LEASE_MS: reconcilerLeaseDurationMs,
    MAESTRO_TLS_CERT_FILE: certFile,
    MAESTRO_TLS_KEY_FILE: keyFile,
  } = parsed.data;

  const isRemoteBind = host !== "127.0.0.1" && host !== "localhost";
  if (isRemoteBind && allowRemote !== "true") {
    throw new Error("Remote binding requires explicit MAESTRO_ALLOW_REMOTE=true");
  }
  if (isRemoteBind && (certFile === undefined || keyFile === undefined)) {
    // Bearer secrets must never travel in cleartext on a non-loopback bind.
    // Fail closed rather than silently serving plain HTTP remotely.
    throw new Error("Remote binding requires TLS certificate and key configuration");
  }

  return {
    databaseUrl, evidenceDir, worktreeRoot, host, port, primeAgentVersion: "0.8.0", actorId, leaseOwnerId, reconcilerLeaseDurationMs,
    ...(ceoOperatorId === undefined ? {} : { ceoOperatorId }),
    ...(operatorProvisioningAdminId === undefined ? {} : { operatorProvisioningAdminId }),
    ...(isRemoteBind ? { tls: { certFile: certFile!, keyFile: keyFile! } } : {}),
  };
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
