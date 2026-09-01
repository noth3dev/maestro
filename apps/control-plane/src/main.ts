import { Pool } from "pg";
import { authenticateLocalOperator, getGoalControl, listGoalEvents, PostgresAuthorityRepository } from "@maestro/persistence";
import type { ActionRequest } from "@maestro/authority";
import { parseConfig, type MaestroConfig } from "./config.js";
import { createCriticalActionService } from "./critical-action-service.js";
import { createDurableGoalService } from "./goal-service.js";
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
  });
  let closed = false;

  return {
    app,
    pool,
    config,
    async listen() {
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
