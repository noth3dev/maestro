import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { authenticateLocalOperator, getGoalControl, listGoalEvents, PostgresAuthorityRepository, reconcileOnStartup } from "@maestro/persistence";
import type { ActionRequest } from "@maestro/authority";
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
}

export interface ControlPlaneOverrides {
  /** Test-only injection point for the critical-action effect callback. Production defaults to a safe no-op. */
  criticalActionEffect?: (request: ActionRequest) => Promise<void>;
}

/** Compose only the Phase 1 local Goal API. Credential setup remains a controlled persistence operation. */
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
  const criticalActionService = createCriticalActionService({
    repository: new PostgresAuthorityRepository(pool),
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
    ...(https ? { https } : {}),
  });
  let closed = false;

  return {
    app,
    pool,
    config,
    async listen() {
      // Fail closed: a real process must prove durable Goal/lease state is
      // consistent (or durably marked "recovering") before it ever serves
      // traffic. If the startup reconciliation leader lease cannot be
      // acquired or reconciliation itself fails, this throws and the caller
      // (main()) closes the pool without binding a listener.
      await reconcileOnStartup(pool, { ownerId: config.leaseOwnerId, leaderLeaseDurationMs: config.reconcilerLeaseDurationMs });
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
