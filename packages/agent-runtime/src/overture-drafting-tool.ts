import { createHash } from "node:crypto";
import {
  CreateTaskContractInputSchema,
  TaskContractSchema,
  TaskContractSubstanceSchema,
  UuidSchema,
  type CreateTaskContractInput,
  type TaskContract,
} from "@maestro/contracts";
import type { ToolDefinition, ToolExecutionResult, ToolContext } from "./agent-runtime.js";

/** The only capability exposed to a goal-less conversational intake runtime. */
export const OVERTURE_TASK_CONTRACT_CREATE_TOOL = "task-contract:create" as const;

export interface TaskContractCreator {
  createTaskContract(contractId: string, input: CreateTaskContractInput, operator: { operatorId: string }): Promise<TaskContract>;
}

type DraftingInput = CreateTaskContractInput | { projectId: string; brief: string };

/** Stable idempotency identity for one exact conversation tool proposal. */
export function deriveTaskContractId(commandId: string, turnId: string, toolCallId: string): string {
  const digest = createHash("sha256").update(JSON.stringify([commandId, turnId, toolCallId]), "utf8").digest("hex").split("");
  digest[12] = "5";
  digest[16] = ((Number.parseInt(digest[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${digest.slice(0, 8).join("")}-${digest.slice(8, 12).join("")}-${digest.slice(12, 16).join("")}-${digest.slice(16, 20).join("")}-${digest.slice(20, 32).join("")}`;
}

function parseDraftingInput(value: unknown): DraftingInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Task Contract drafting input must be an object");
  const record = value as Record<string, unknown>;
  if (record.substance !== undefined) return CreateTaskContractInputSchema.parse(value);
  const projectId = UuidSchema.parse(record.projectId);
  if (typeof record.brief !== "string" || record.brief.trim() === "") throw new Error("Task Contract drafting brief is required");
  return { projectId, brief: record.brief };
}

function parseToolResult(value: unknown): ToolExecutionResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Task Contract drafting result must be an object");
  const status = (value as Record<string, unknown>).status;
  const content = (value as Record<string, unknown>).content;
  if ((status !== "ok" && status !== "error" && status !== "unknown") || typeof content !== "string") throw new Error("Task Contract drafting result is invalid");
  return { status, content };
}

const substanceJsonSchema = (() => {
  const schema = (TaskContractSubstanceSchema as typeof TaskContractSubstanceSchema & { toJSONSchema?: () => unknown });
  return schema.toJSONSchema?.() ?? { type: "object", description: "A complete TaskContractSubstance. Every field is required." };
})();

/**
 * Builds the Overture intake tool. The model must elaborate a complete
 * TaskContractSubstance before invoking it; a raw or vague brief is answered
 * with a clarification request and never reaches durable storage.
 */
export function createTaskContractDraftingTool(options: {
  createTaskContract: TaskContractCreator["createTaskContract"];
  onCreated?: (contract: TaskContract, context: Pick<ToolContext, "commandId">) => void;
}): ToolDefinition {
  const creator = options.createTaskContract;
  return {
    name: OVERTURE_TASK_CONTRACT_CREATE_TOOL,
    version: "1",
    description: "Create a durable Task Contract from a complete Overture draft. Elaborate the operator's brief into every required TaskContractSubstance field first. If required facts are missing, ask a focused clarification question; do not invent values. This tool only creates an awaiting-confirmation contract and never launches execution.",
    inputSchema: { parse: parseDraftingInput },
    outputSchema: { parse: parseToolResult },
    modelInputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        projectId: { type: "string", format: "uuid" },
        brief: { type: "string", minLength: 1, description: "Use only when asking for clarification; never treat a vague brief as a complete draft." },
        substance: substanceJsonSchema,
      },
      required: ["projectId"],
      description: "Provide substance only after honestly filling every required field. A brief alone never creates a contract.",
    },
    allowsParallel: false,
    outboundDataClass: "workspace",
    async execute(args, context) {
      if (context.goalId !== undefined) throw new Error("Task Contract drafting is available only to goal-less conversations");
      if (!context.capabilityGrant.allowedTools.includes(OVERTURE_TASK_CONTRACT_CREATE_TOOL)) throw new Error("Task Contract drafting tool is outside the invocation grant");
      const input = parseDraftingInput(args);
      if (input.projectId !== context.projectId) throw new Error("Task Contract drafting project does not match the conversation project");
      if ("brief" in input) {
        return { status: "ok", content: "I need clarification before creating a Task Contract. Please specify the desired outcome, user-visible behavior, success criteria, scope, non-goals, constraints, and budget ceiling." };
      }
      if (input.substance.project.projectId !== context.projectId) throw new Error("Task Contract substance project does not match the conversation project");
      const contract = await creator(deriveTaskContractId(context.commandId, context.turnId, context.toolCallId), input, { operatorId: context.operatorId });
      // Validate the durable service response at this authority boundary. A
      // malformed or shadow response must never be presented as a contract.
      const parsed = TaskContractSchema.parse(contract);
      options.onCreated?.(parsed, context);
      return { status: "ok", content: JSON.stringify(parsed) };
    },
  };
}
