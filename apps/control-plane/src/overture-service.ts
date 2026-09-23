import type { Pool } from "pg";
import { ToolRegistry, type ModelGatewayPort } from "@maestro/agent-runtime";
import type {
  AppendOvertureMessageInput,
  CreateOvertureRunInput,
  OvertureArtifact,
  OvertureEvent,
  OvertureMessage,
  OverturePlanManifest,
  OvertureRun,
} from "@maestro/contracts";
import type { OperatorContext } from "@maestro/persistence";
import { createOvertureRoleTurnRunner, OvertureProviderUnavailableError, type OvertureRoleTurnRunner } from "./overture-role-turn.js";
import {
  appendOvertureMessage,
  assertProjectRole,
  readOvertureArtifacts,
  bindOvertureRoleModel,
  createOvertureRun,
  readOvertureEvents,
  readOvertureMessages,
  readOverturePlanManifest,
  readOvertureRun,
  OvertureRunNotFoundError,
} from "@maestro/persistence";

export interface OvertureService {
  createRun(input: CreateOvertureRunInput, operator: OperatorContext): Promise<OvertureRun>;
  appendOperatorMessage(input: AppendOvertureMessageInput, operator: OperatorContext): Promise<OvertureMessage>;
  listArtifacts(runId: string, projectId: string, conversationId: string, operator: OperatorContext): Promise<readonly OvertureArtifact[]>;
  readPlanManifest(runId: string, projectId: string, conversationId: string, operator: OperatorContext): Promise<OverturePlanManifest>;
  listMessages(
    runId: string,
    projectId: string,
    conversationId: string,
    afterCursor: string,
    operator: OperatorContext,
  ): Promise<readonly OvertureMessage[]>;
  getRun(runId: string, projectId: string, conversationId: string, operator: OperatorContext): Promise<OvertureRun>;
  listEvents(
    runId: string,
    projectId: string,
    conversationId: string,
    afterCursor: string,
    operator: OperatorContext,
  ): Promise<readonly OvertureEvent[]>;
}

export interface OvertureServiceOptions {
  readonly pool: Pool;
  readonly gateway?: ModelGatewayPort;
  readonly gatewayOperatorId?: string;
  readonly accountRefs?: Readonly<Record<string, string>>;
  readonly dataPolicyHash?: string;
  readonly tools?: ToolRegistry;
}

export function createPostgresOvertureService(options: Pool | OvertureServiceOptions): OvertureService {
  const pool = "query" in options ? options : options.pool;
  const roleTurnRunner: OvertureRoleTurnRunner | undefined =
    "query" in options || options.gateway === undefined
      ? undefined
      : createOvertureRoleTurnRunner({
          gateway: options.gateway,
          gatewayOperatorId: options.gatewayOperatorId ?? "local-operator",
          accountRefs: options.accountRefs ?? {},
          dataPolicyHash: options.dataPolicyHash ?? "maestro-overture-v1",
          tools: options.tools ?? new ToolRegistry(),
          readModel: async (projectId, conversationId) => {
            const result = await pool.query<{ model_provider: string; model_id: string }>(
              "SELECT model_provider, model_id FROM conversations WHERE conversation_id = $1 AND project_id = $2",
              [conversationId, projectId],
            );
            if (result.rowCount !== 1) throw new OvertureProviderUnavailableError("Overture conversation model is unavailable");
            return { provider: result.rows[0]!.model_provider, id: result.rows[0]!.model_id };
          },
          readMessages: (runId, projectId, conversationId) => readOvertureMessages(pool, runId, projectId, conversationId),
          bindRoleModel: (input) => bindOvertureRoleModel(pool, input),
          appendRoleMessage: (input) => appendOvertureMessage(pool, input),
        });

  async function assertRole(operator: OperatorContext, projectId: string): Promise<void> {
    await assertProjectRole(pool, operator.operatorId, projectId, "concertmaster");
  }

  return {
    async createRun(input, operator) {
      await assertRole(operator, input.projectId);
      return createOvertureRun(pool, input);
    },
    async appendOperatorMessage(input, operator) {
      await assertRole(operator, input.projectId);
      if (input.actor !== "operator" || input.modelRef !== null) throw new Error("Overture operator messages must be operator-authored");
      const message = await appendOvertureMessage(pool, input);
      if (roleTurnRunner !== undefined) {
        const run = await readOvertureRun(pool, input.runId, input.projectId, input.conversationId);
        if (run?.roles.some((role) => role.roleId === "conversation-lead" && role.status === "active"))
          await roleTurnRunner.run({
            runId: input.runId,
            projectId: input.projectId,
            conversationId: input.conversationId,
            turnId: input.turnId,
            operatorMessageId: message.messageId,
            operatorId: operator.operatorId,
            content: input.content,
          });
      }
      return message;
    },
    async listArtifacts(runId, projectId, conversationId, operator) {
      await assertRole(operator, projectId);
      return readOvertureArtifacts(pool, runId, projectId, conversationId);
    },
    async readPlanManifest(runId, projectId, conversationId, operator) {
      await assertRole(operator, projectId);
      return readOverturePlanManifest(pool, runId, projectId, conversationId);
    },
    async listMessages(runId, projectId, conversationId, afterCursor, operator) {
      await assertRole(operator, projectId);
      return readOvertureMessages(pool, runId, projectId, conversationId, afterCursor);
    },
    async getRun(runId, projectId, conversationId, operator) {
      await assertRole(operator, projectId);
      const run = await readOvertureRun(pool, runId, projectId, conversationId);
      if (run === undefined) throw new OvertureRunNotFoundError("Overture run not found");
      return run;
    },
    async listEvents(runId, projectId, conversationId, afterCursor, operator) {
      await assertRole(operator, projectId);
      return readOvertureEvents(pool, runId, projectId, conversationId, afterCursor);
    },
  };
}
