import type { Pool } from "pg";
import type { AppendOvertureMessageInput, CreateOvertureRunInput, OvertureEvent, OvertureMessage, OvertureRun } from "@maestro/contracts";
import type { OperatorContext } from "@maestro/persistence";
import {
  appendOvertureMessage,
  assertProjectRole,
  createOvertureRun,
  readOvertureEvents,
  readOvertureMessages,
  readOvertureRun,
  OvertureRunNotFoundError,
} from "@maestro/persistence";

export interface OvertureService {
  createRun(input: CreateOvertureRunInput, operator: OperatorContext): Promise<OvertureRun>;
  appendOperatorMessage(input: AppendOvertureMessageInput, operator: OperatorContext): Promise<OvertureMessage>;
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

export function createPostgresOvertureService(pool: Pool): OvertureService {
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
      return appendOvertureMessage(pool, input);
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
