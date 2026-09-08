import { z } from "zod";

export type ModelRoutingMode = "ensemble" | "pin";

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
  actorId: string;
  leaseOwnerId: string;
  /** Optional explicit CEO identity; approvals fail closed when absent. */
  ceoOperatorId?: string;
  /** Optional explicit operator allowed to provision project memberships and roles. */
  operatorProvisioningAdminId?: string;
  /** Shared secret verifying an inbound Discord watchdog signal's own signature. Absent by default: fails closed (route unavailable) until explicitly configured. */
  discordSignalCredential?: string;
  /** Continuous Metronome scan interval. Absent by default: the loop does not run until explicitly configured. */
  metronomeIntervalMs?: number;
  /** Phase 5 capacity-model first slice: project-wide worker-slot ceiling. Absent by default: unlimited, matching current behavior. */
  maxConcurrentWorkersPerProject?: number;
  /** Duration of the startup-only reconciliation-leader lease; never renewed after startup. */
  reconcilerLeaseDurationMs: number;
  /** Maximum time allowed for provider/application shutdown drains. */
  shutdownDrainTimeoutMs?: number;
  /** Absolute trusted Python executable for the Goal-bound IPython child. */
  ipythonPythonExecutable?: string;
  /** Optional authenticated model gateway; native execution is unavailable when absent. */
  modelGatewayUrl?: string;
  /** Explicit routing mode. `pin` is the fail-closed MAESTRO_NATIVE_MODEL mode; `ensemble` is the future Ensemble Router mode. */
  modelRoutingMode: ModelRoutingMode;
  /** Explicit provider-qualified model used only when routing mode is `pin`. */
  nativeModelRef?: string;
  modelGatewayToken?: string;
  modelGatewayOperatorId: string;
  modelAccountRefs: Readonly<Record<string, string>>;
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
  MAESTRO_SHUTDOWN_DRAIN_MS: z.coerce.number().int().positive().default(5_000),
  MAESTRO_MODEL_GATEWAY_URL: z.string().url().default("http://127.0.0.1:4321"),
  MAESTRO_MODEL_GATEWAY_TOKEN: z.string().min(1).optional(),
  MAESTRO_MODEL_GATEWAY_OPERATOR_ID: z.string().min(1).default("local-operator"),
  MAESTRO_NATIVE_MODEL: z
    .string()
    .regex(/^[^/\s]+\/[^/\s]+$/)
    .optional(),
  MAESTRO_MODEL_ROUTING_MODE: z.enum(["ensemble", "pin"]).optional(),
  MAESTRO_MODEL_ACCOUNT_REFS: z.string().optional(),
  MAESTRO_TLS_CERT_FILE: z.string().min(1).optional(),
  MAESTRO_TLS_KEY_FILE: z.string().min(1).optional(),
  MAESTRO_DISCORD_SIGNAL_CREDENTIAL: z.string().min(1).optional(),
  MAESTRO_METRONOME_INTERVAL_MS: z.coerce.number().int().positive().optional(),
  MAESTRO_MAX_CONCURRENT_WORKERS_PER_PROJECT: z.coerce.number().int().positive().optional(),
  MAESTRO_IPYTHON_PYTHON: z.string().regex(/^\/.+/).optional(),
});

export function parseConfig(env: Record<string, string | undefined>): MaestroConfig {
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
    MAESTRO_SHUTDOWN_DRAIN_MS: shutdownDrainTimeoutMs,
    MAESTRO_MODEL_GATEWAY_URL: modelGatewayUrl,
    MAESTRO_MODEL_GATEWAY_TOKEN: modelGatewayToken,
    MAESTRO_MODEL_GATEWAY_OPERATOR_ID: modelGatewayOperatorId,
    MAESTRO_NATIVE_MODEL: nativeModelRef,
    MAESTRO_MODEL_ROUTING_MODE: configuredRoutingMode,
    MAESTRO_MODEL_ACCOUNT_REFS: modelAccountRefsRaw,
    MAESTRO_TLS_CERT_FILE: certFile,
    MAESTRO_TLS_KEY_FILE: keyFile,
    MAESTRO_DISCORD_SIGNAL_CREDENTIAL: discordSignalCredential,
    MAESTRO_METRONOME_INTERVAL_MS: metronomeIntervalMs,
    MAESTRO_MAX_CONCURRENT_WORKERS_PER_PROJECT: maxConcurrentWorkersPerProject,
    MAESTRO_IPYTHON_PYTHON: ipythonPythonExecutable,
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

  const modelRoutingMode: ModelRoutingMode = configuredRoutingMode ?? (nativeModelRef === undefined ? "ensemble" : "pin");
  if (modelRoutingMode === "pin" && nativeModelRef === undefined)
    throw new Error("MAESTRO_MODEL_ROUTING_MODE=pin requires MAESTRO_NATIVE_MODEL");
  if (modelRoutingMode === "ensemble" && nativeModelRef !== undefined)
    throw new Error("MAESTRO_NATIVE_MODEL requires MAESTRO_MODEL_ROUTING_MODE=pin");

  const accountRefs: Record<string, string> = {};
  for (const entry of (modelAccountRefsRaw ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)) {
    const separator = entry.indexOf("=");
    if (separator <= 0 || separator === entry.length - 1) throw new Error("Invalid MAESTRO_MODEL_ACCOUNT_REFS");
    const provider = entry.slice(0, separator).trim();
    const accountRef = entry.slice(separator + 1).trim();
    if (!/^[A-Za-z0-9._-]+$/.test(provider) || !/^[A-Za-z0-9._:-]+$/.test(accountRef))
      throw new Error("Invalid MAESTRO_MODEL_ACCOUNT_REFS");
    accountRefs[provider] = accountRef;
  }
  for (const provider of ["openai", "anthropic"]) accountRefs[provider] ??= `${provider}-${modelGatewayOperatorId}`;

  return {
    databaseUrl,
    evidenceDir,
    worktreeRoot,
    host,
    port,
    actorId,
    leaseOwnerId,
    reconcilerLeaseDurationMs,
    shutdownDrainTimeoutMs,
    modelRoutingMode,
    modelGatewayOperatorId,
    modelAccountRefs: accountRefs,
    modelGatewayUrl,
    ...(modelGatewayToken === undefined ? {} : { modelGatewayToken }),
    ...(nativeModelRef === undefined ? {} : { nativeModelRef }),
    ...(ceoOperatorId === undefined ? {} : { ceoOperatorId }),
    ...(operatorProvisioningAdminId === undefined ? {} : { operatorProvisioningAdminId }),
    ...(discordSignalCredential === undefined ? {} : { discordSignalCredential }),
    ...(metronomeIntervalMs === undefined ? {} : { metronomeIntervalMs }),
    ...(maxConcurrentWorkersPerProject === undefined ? {} : { maxConcurrentWorkersPerProject }),
    ...(ipythonPythonExecutable === undefined ? {} : { ipythonPythonExecutable }),
    ...(isRemoteBind ? { tls: { certFile: certFile!, keyFile: keyFile! } } : {}),
  };
}

/** Safe for operational logs; it intentionally omits all database user info and query parameters. */
export function redactConfig(config: MaestroConfig): Omit<MaestroConfig, "modelGatewayToken"> {
  const { modelGatewayToken: _modelGatewayToken, ...safe } = config;
  return { ...safe, databaseUrl: redactDatabaseUrl(config.databaseUrl) };
}

function redactDatabaseUrl(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    return `${url.protocol}//[redacted]@${url.host}${url.pathname}`;
  } catch {
    return "[redacted]";
  }
}
