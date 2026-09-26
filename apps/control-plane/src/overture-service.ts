import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { ToolRegistry, type ModelGatewayPort } from "@maestro/agent-runtime";
import type {
  AppendOvertureMessageInput,
  CreateOvertureRunInput,
  OvertureArtifact,
  OvertureEvent,
  OvertureMessage,
  OverturePlanDocument,
  OverturePlanManifest,
  OvertureClarification,
  OvertureRun,
  TaskContract,
  CreateOvertureTaskContractInput,
  CreateOvertureWorkspaceTaskContractInput,
  OpenOvertureClarificationInput,
  AnswerOvertureClarificationInput,
  ReviseOverturePlanInput,
} from "@maestro/contracts";
import type { OperatorContext } from "@maestro/persistence";
import type { SessionWorkspace } from "./session-workspace.js";
import { TaskMarkdownError, taskContractFromMarkdown } from "./task-md.js";
import { createOvertureRoleTurnRunner, OvertureProviderUnavailableError, type OvertureRoleTurnRunner } from "./overture-role-turn.js";
import {
  appendOvertureMessage,
  assertProjectRole,
  attachOvertureTaskContract,
  attachOvertureWorkspaceTaskContract,
  createDurableTaskContract,
  reviseOverturePlan,
  openOvertureClarification,
  answerOvertureClarification,
  createOvertureOperatorTurn,
  readOvertureArtifacts,
  bindOvertureRoleModel,
  createOvertureRun,
  readOvertureEvents,
  readOvertureRunsForConversation,
  readOvertureMessages,
  readOverturePlanManifest,
  readOvertureRun,
  OvertureConflictError,
  OvertureRunNotFoundError,
} from "@maestro/persistence";

const TASK_PATH = "task.md";

export interface OvertureService {
  createRun(input: CreateOvertureRunInput, operator: OperatorContext): Promise<OvertureRun>;
  appendOperatorMessage(input: AppendOvertureMessageInput, operator: OperatorContext): Promise<OvertureMessage>;
  listArtifacts(runId: string, projectId: string, conversationId: string, operator: OperatorContext): Promise<readonly OvertureArtifact[]>;
  readPlanManifest(runId: string, projectId: string, conversationId: string, operator: OperatorContext): Promise<OverturePlanManifest>;
  revisePlan(input: ReviseOverturePlanInput, operator: OperatorContext): Promise<OverturePlanDocument>;
  createTaskContract(input: CreateOvertureTaskContractInput, operator: OperatorContext): Promise<TaskContract>;
  /** Draft the awaiting Task Contract from task.md at the reviewed workspace revision. */
  createWorkspaceTaskContract?(input: CreateOvertureWorkspaceTaskContractInput, operator: OperatorContext): Promise<TaskContract>;
  openClarification(input: OpenOvertureClarificationInput, operator: OperatorContext): Promise<OvertureClarification>;
  answerClarification(input: AnswerOvertureClarificationInput, operator: OperatorContext): Promise<OvertureClarification>;
  listMessages(
    runId: string,
    projectId: string,
    conversationId: string,
    afterCursor: string,
    operator: OperatorContext,
  ): Promise<readonly OvertureMessage[]>;
  getRun(runId: string, projectId: string, conversationId: string, operator: OperatorContext): Promise<OvertureRun>;
  /** Resolves once background crew turns have finished (tests and shutdown). */
  idle?(): Promise<void>;
  /** Runs attached to one conversation, oldest first. */
  listRuns?(projectId: string, conversationId: string, operator: OperatorContext): Promise<readonly OvertureRun[]>;

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
  /** The per-conversation Git workspaces Overture writes plan files into. */
  readonly sessionWorkspace?: SessionWorkspace;
  /** When set, Overture roles get the session `ipython` tool for their conversation's workspace. */
  readonly sessionTools?: (scope: { projectId: string; conversationId: string }) => ToolRegistry;
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
          tools:
            options.sessionTools ?? options.tools ?? new ToolRegistry(),
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

  // Role turns can run for minutes (model calls plus workspace tool calls), so
  // they run after the request returns, one at a time per Run. The chat polls
  // for the reply; a failure is posted as a visible crew message.
  const runQueues = new Map<string, Promise<void>>();
  const inFlight = new Set<Promise<void>>();
  function scheduleRoleTurn(input: Parameters<OvertureRoleTurnRunner["run"]>[0]): void {
    if (roleTurnRunner === undefined) return;
    const runner = roleTurnRunner;
    const previous = runQueues.get(input.runId) ?? Promise.resolve();
    const task = previous.then(async () => {
      try {
        await runner.run(input);
      } catch (error) {
        const reason = error instanceof Error && error.message.trim() !== "" ? error.message : "unknown error";
        await appendOvertureMessage(pool, {
          runId: input.runId,
          projectId: input.projectId,
          conversationId: input.conversationId,
          turnId: input.turnId,
          actor: "conversation-lead",
          modelRef: null,
          content: `This Overture turn could not finish: ${reason.slice(0, 500)}`,
          commandId: randomUUID(),
        }).catch(() => undefined);
      }
    });
    runQueues.set(input.runId, task);
    inFlight.add(task);
    void task.finally(() => {
      inFlight.delete(task);
      if (runQueues.get(input.runId) === task) runQueues.delete(input.runId);
    });
  }

  return {
    async idle() {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
    },
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
          scheduleRoleTurn({
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
    async revisePlan(input, operator) {
      await assertRole(operator, input.projectId);
      return reviseOverturePlan(pool, input);
    },
    async openClarification(input, operator) {
      await assertRole(operator, input.projectId);
      return openOvertureClarification(pool, input);
    },
    async answerClarification(input, operator) {
      await assertRole(operator, input.projectId);
      const clarification = await answerOvertureClarification(pool, input);
      const run = await readOvertureRun(pool, input.runId, input.projectId, input.conversationId);
      if (run === undefined) throw new OvertureRunNotFoundError("Overture run not found");
      const turn = await createOvertureOperatorTurn(pool, {
        runId: input.runId,
        projectId: input.projectId,
        conversationId: input.conversationId,
        content: input.answer,
        commandId: input.commandId,
      });
      const operatorMessage = await appendOvertureMessage(pool, {
        runId: input.runId,
        projectId: input.projectId,
        conversationId: input.conversationId,
        turnId: turn.turnId,
        actor: "operator",
        modelRef: null,
        content: input.answer,
        commandId: turn.messageCommandId,
      });
      const roleActive = run.roles.some((role) => role.roleId === "conversation-lead" && role.status === "active");
      if (roleTurnRunner !== undefined && roleActive) {
        const messages = await readOvertureMessages(pool, input.runId, input.projectId, input.conversationId);
        const roleAlreadyAnswered = messages.some((message) => message.turnId === turn.turnId && message.actor === "conversation-lead");
        if (!roleAlreadyAnswered) {
          scheduleRoleTurn({
            runId: input.runId,
            projectId: input.projectId,
            conversationId: input.conversationId,
            turnId: turn.turnId,
            operatorMessageId: operatorMessage.messageId,
            operatorId: operator.operatorId,
            content: input.answer,
          });
        }
      }
      return clarification;
    },
    async createTaskContract(input, operator) {
      await assertRole(operator, input.projectId);
      const contract = await createDurableTaskContract(pool, input.commandId, input.substance);
      await attachOvertureTaskContract(pool, {
        runId: input.runId,
        projectId: input.projectId,
        conversationId: input.conversationId,
        contractId: contract.contractId,
        planId: input.planId,
        planVersion: input.planVersion,
        manifestHash: input.manifestHash,
        commandId: input.commandId,
      });
      return contract;
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
    async createWorkspaceTaskContract(input, operator) {
      await assertRole(operator, input.projectId);
      const workspace = "query" in options ? undefined : options.sessionWorkspace;
      if (workspace === undefined) throw new OvertureConflictError("The session workspace is unavailable");
      const run = await readOvertureRun(pool, input.runId, input.projectId, input.conversationId);
      if (run === undefined) throw new OvertureRunNotFoundError("Overture run not found");
      const assertRevision = async () => {
        const listing = await workspace.list(input.projectId, input.conversationId);
        if (listing.revision !== input.revision) throw new OvertureConflictError("The workspace changed after review; reload the files and try again");
        return listing;
      };
      const listing = await assertRevision();
      if (!listing.files.some((file) => file.path === TASK_PATH)) throw new TaskMarkdownError("Write task.md in the workspace first");
      const files = await Promise.all(listing.files.map((file) => workspace.read(input.projectId, input.conversationId, file.path)));
      await assertRevision();
      const hash = (content: string) => createHash("sha256").update(content, "utf8").digest("hex");
      const evidence = files.map((file) => `workspace@${input.revision}:${file.path}#${hash(file.content)}`);
      const task = files.find((file) => file.path === TASK_PATH)!;
      const substance = taskContractFromMarkdown({
        markdown: task.content,
        projectId: input.projectId,
        evidence,
        documents: files.filter((file) => file.path.endsWith(".md")).map((file) => file.path),
      });
      const contract = await createDurableTaskContract(pool, input.commandId, substance);
      await attachOvertureWorkspaceTaskContract(pool, {
        runId: input.runId,
        projectId: input.projectId,
        conversationId: input.conversationId,
        contractId: contract.contractId,
        workspaceRevision: input.revision,
        taskPath: TASK_PATH,
        contentHash: hash(task.content),
        commandId: input.commandId,
      });
      return contract;
    },
    async listRuns(projectId, conversationId, operator) {
      await assertRole(operator, projectId);
      return readOvertureRunsForConversation(pool, projectId, conversationId);
    },
    async listEvents(runId, projectId, conversationId, afterCursor, operator) {
      await assertRole(operator, projectId);
      return readOvertureEvents(pool, runId, projectId, conversationId, afterCursor);
    },
  };
}
