import { randomUUID } from "node:crypto";
import {
  createOvertureRoleRuntime,
  type ModelGatewayPort,
  type ModelIdentity,
  type ModelMessage,
  ToolRegistry,
} from "@maestro/agent-runtime";
import { createOvertureRoleRuntimePolicy } from "@maestro/domain";
import type { OvertureMessage } from "@maestro/contracts";

export class OvertureProviderUnavailableError extends Error {}

export interface OvertureRoleTurnInput {
  readonly runId: string;
  readonly projectId: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly operatorMessageId: string;
  readonly operatorId: string;
  readonly content: string;
}

export interface OvertureRoleTurnRunner {
  run(input: OvertureRoleTurnInput): Promise<OvertureMessage>;
}

export function createOvertureRoleTurnRunner(options: {
  readonly gateway: ModelGatewayPort;
  readonly gatewayOperatorId: string;
  readonly accountRefs: Readonly<Record<string, string>>;
  readonly dataPolicyHash: string;
  /** Tools for one turn; a factory receives the turn's conversation scope. */
  readonly tools: ToolRegistry | ((scope: { projectId: string; conversationId: string }) => ToolRegistry);
  readonly readModel: (projectId: string, conversationId: string) => Promise<ModelIdentity>;
  readonly readMessages: (runId: string, projectId: string, conversationId: string) => Promise<readonly OvertureMessage[]>;
  readonly bindRoleModel: (input: { runId: string; projectId: string; roleId: "conversation-lead"; modelRef: string }) => Promise<void>;
  readonly appendRoleMessage: (input: {
    runId: string;
    projectId: string;
    conversationId: string;
    turnId: string;
    actor: "conversation-lead";
    modelRef: string;
    content: string;
    commandId: string;
  }) => Promise<OvertureMessage>;
}): OvertureRoleTurnRunner {
  return {
    async run(input) {
      const model = await options.readModel(input.projectId, input.conversationId);
      const accountRef = options.accountRefs[model.provider];
      if (accountRef === undefined) throw new OvertureProviderUnavailableError(`No account is configured for provider ${model.provider}`);
      const modelRef = `${model.provider}/${model.id}`;
      await options.bindRoleModel({ runId: input.runId, projectId: input.projectId, roleId: "conversation-lead", modelRef });
      const requestId = randomUUID();
      const binding = await options.gateway.admit({
        requestId,
        operatorId: options.gatewayOperatorId,
        providerId: model.provider,
        model,
        accountRef,
        dataPolicyHash: options.dataPolicyHash,
      });
      const policy = createOvertureRoleRuntimePolicy({
        roleId: "conversation-lead",
        projectId: input.projectId,
        runId: input.runId,
        conversationId: input.conversationId,
      });
      const initialMessages: ModelMessage[] = (await options.readMessages(input.runId, input.projectId, input.conversationId))
        .filter((message) => message.messageId !== input.operatorMessageId)
        .map((message) => ({
          role: message.actor === "operator" ? "user" : "assistant",
          content: [{ kind: "text", text: message.content }],
        }));
      const roleRuntime = createOvertureRoleRuntime({
        gateway: options.gateway,
        binding,
        policy,
        modelRef,
        tools: typeof options.tools === "function" ? options.tools({ projectId: input.projectId, conversationId: input.conversationId }) : options.tools,
        closeGateway: false,
        initialMessages,
      });
      const spawned = await roleRuntime.runtime.spawn({
        name: `overture-${policy.roleId}-${input.runId}`,
        context: {
          operatorId: input.operatorId,
          projectId: input.projectId,
          missionBundleId: "overture",
          policyVersion: "overture-task15-v1",
          accountRef,
        },
        grant: roleRuntime.grant,
        modelPolicy: [modelRef],
        idempotencyKey: requestId,
      });
      try {
        await roleRuntime.runtime.prompt(spawned.execution, input.content);
        const observation = (await roleRuntime.runtime.observe(spawned.execution)).find((item) => item.invocation === spawned.invocation);
        const answer = observation?.answer;
        if (answer?.state !== "available" || answer.text.trim() === "") {
          const tools = observation?.toolEvents.state === "available" ? observation.toolEvents.events.length : 0;
          const detail = observation?.error === undefined ? "" : `: ${String((observation.error as { message?: unknown }).message ?? observation.error).slice(0, 300)}`;
          throw new OvertureProviderUnavailableError(`Provider returned no bounded role answer (${observation?.status ?? "no observation"}, ${tools} tool events${detail})`);
        }
        return await options.appendRoleMessage({
          runId: input.runId,
          projectId: input.projectId,
          conversationId: input.conversationId,
          turnId: input.turnId,
          actor: "conversation-lead",
          modelRef,
          content: answer.text,
          commandId: randomUUID(),
        });
      } finally {
        await roleRuntime.runtime.release?.(spawned.invocation);
        await roleRuntime.runtime.close?.();
      }
    },
  };
}
