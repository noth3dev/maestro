import { Pool } from "pg";
import { authenticateLocalOperator, listGoalEvents, reconcileOnStartup } from "@maestro/persistence";
import { parseConfig, type MaestroConfig } from "./config.js";
import { createDurableGoalService } from "./goal-service.js";
import { buildServer, type OperatorAuthenticator } from "./server.js";

export interface ControlPlane {
  app: ReturnType<typeof buildServer>;
  pool: Pool;
  config: MaestroConfig;
  listen(): Promise<void>;
  close(): Promise<void>;
}

/** Compose only the Phase 1 local Goal API. Credential setup remains a controlled persistence operation. */
export function createControlPlane(config: MaestroConfig): ControlPlane {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const goalService = createDurableGoalService({
    pool,
    actorId: config.actorId,
    leaseOwnerId: config.leaseOwnerId,
  });
  const authenticator: OperatorAuthenticator = {
    authenticateBearerSecret: (secret) => authenticateLocalOperator(pool, secret),
  };
  const app = buildServer({ goalService, authenticator, eventService: { listEvents: (projectId, after) => listGoalEvents(pool, { projectId, after }) } });
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
