import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { AuthorizedEffectExecutor, type ActionRequest } from "@maestro/authority";
import { createLocalGitPort } from "@maestro/git-adapter";
import type { GitPort } from "@maestro/domain";
import { assertProjectMembership, authenticateLocalOperator, getGoalControl, listGoalEvents, PostgresAuthorityRepository, reconcileOnStartup, runMigrations } from "@maestro/persistence";
import { createPrimeExecutionKernel } from "@maestro/prime-adapter";
import { parseConfig, type MaestroConfig } from "./config.js";
import { createCriticalActionService } from "./critical-action-service.js";
import { createDurableGoalService } from "./goal-service.js";
import { createReadStateService } from "./read-state-service.js";
import { buildServer, type OperatorAuthenticator } from "./server.js";

export interface ControlPlane {
  app: ReturnType<typeof buildServer>;
  pool: Pool;
  config: MaestroConfig;
  listen(): Promise<void>;
  close(): Promise<void>;
  /** The production authority gateway for runtime/browser effect adapters. */
  createEnvironmentAuthority(): AuthorizedEffectExecutor;
  /** Builds a Git port whose every operation is audited and control-checked. */
  createGitPort(context: Omit<ActionRequest, "action" | "target">): GitPort;
}

export interface ControlPlaneOverrides {
  /** Test-only injection point for the critical-action effect callback. Production defaults to a safe no-op. */
  criticalActionEffect?: (request: ActionRequest) => Promise<void>;
}

/** Compose the local Goal API and expose only authority-backed effect gateways. Credential setup remains a controlled persistence operation. */
export function createControlPlane(config: MaestroConfig, overrides: ControlPlaneOverrides = {}): ControlPlane {
  // Enforce the TLS-fail-closed invariant at this composition boundary too,
  // not only in parseConfig: a caller may construct MaestroConfig directly
  // (bypassing parseConfig entirely), and bearer secrets must never travel
  // in cleartext on a non-loopback bind either way.
  const isRemoteBind = config.host !== "127.0.0.1" && config.host !== "localhost";
  if (isRemoteBind && !config.tls) {
    throw new Error("Remote binding requires TLS certificate and key configuration");
  }
  const https = config.tls ? { cert: readFileSync(config.tls.certFile), key: readFileSync(config.tls.keyFile) } : undefined;
  const pool = new Pool({ connectionString: config.databaseUrl });
  const goalService = createDurableGoalService({
    pool,
    actorId: config.actorId,
    leaseOwnerId: config.leaseOwnerId,
  });
  const authenticator: OperatorAuthenticator = {
    authenticateBearerSecret: (secret) => authenticateLocalOperator(pool, secret),
  };
  const authorityRepository = new PostgresAuthorityRepository(pool);
  const authorityExecutor = new AuthorizedEffectExecutor(authorityRepository);
  const criticalActionService = createCriticalActionService({
    repository: authorityRepository,
    getControlEpoch: async (projectId, goalId) => (await getGoalControl(pool, projectId, goalId)).controlEpoch,
    // The gateway is the point of this endpoint; no real external effect is wired in Phase 1.
    effect: overrides.criticalActionEffect ?? (async () => {}),
  });
  const app = buildServer({
    goalService,
    authenticator,
    eventService: { listEvents: (projectId, after) => listGoalEvents(pool, { projectId, after }) },
    criticalActionService,
    readStateService: createReadStateService(pool),
    projectMembership: { assertProjectMembership: (operatorId, projectId) => assertProjectMembership(pool, operatorId, projectId) },
    ...(https ? { https } : {}),
  });
  let closed = false;

  return {
    app,
    pool,
    config,
    createEnvironmentAuthority() {
      return authorityExecutor;
    },
    createGitPort(context) {
      return createLocalGitPort({ authority: authorityExecutor, context });
    },
    async listen() {
      // The schema must be current before any reconciliation or traffic:
      // apply every not-yet-recorded migration (additive-only, advisory-
      // lock-serialized against concurrent instances, fails closed on a
      // changed already-applied migration file) before reconcileOnStartup
      // ever queries goal/lease/control tables that a pending migration
      // might still be introducing.
      await runMigrations(pool);
      // Fail closed: a real process must prove durable Goal/lease state is
      // consistent (or durably marked "recovering") before it ever serves
      // traffic. If the startup reconciliation leader lease cannot be
      // acquired or reconciliation itself fails, this throws and the caller
      // (main()) closes the pool without binding a listener.
      // A freshly constructed kernel here always starts with empty
      // sessions/roots/children state (see execution-kernel.ts), so forcing
      // every orphaned nonterminal worker through it during reconciliation
      // can only ever honestly downgrade a genuinely dead session to
      // "unknown" -- never fabricate or accidentally resume one (Phase 1
      // re-patch item 8 part 2/2: durable worker/session restart recovery).
      await reconcileOnStartup(pool, {
        ownerId: config.leaseOwnerId,
        leaderLeaseDurationMs: config.reconcilerLeaseDurationMs,
        kernel: createPrimeExecutionKernel(),
      });
      await app.listen({ host: config.host, port: config.port });
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        await app.close();
      } finally {
        await pool.end();
      }
    },
  };
}

export async function main(env = process.env): Promise<void> {
  const controlPlane = createControlPlane(parseConfig(env));
  const close = async () => { await controlPlane.close(); };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  try {
    await controlPlane.listen();
  } catch (error) {
    await controlPlane.close();
    throw error;
  }
}

if (import.meta.url === new URL(process.argv[1]!, "file:").href) {
  void main().catch(() => {
    console.error("Control plane failed to start");
    process.exitCode = 1;
  });
}
