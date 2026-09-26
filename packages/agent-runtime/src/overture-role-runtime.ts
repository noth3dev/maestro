import type { CapabilityGrant } from "@maestro/domain";
import type { GatewayBinding, ModelGatewayPort, ModelStreamEvent } from "./model-provider.js";
import { createMaestroAgentRuntime, type MaestroAgentRuntime } from "./agent-runtime.js";
import { ToolRegistry } from "./runtime/tool-registry.js";
import type { OvertureRoleRuntimePolicy } from "@maestro/domain";

export interface OvertureRoleRuntime {
  readonly runtime: MaestroAgentRuntime;
  readonly grant: CapabilityGrant;
}

export function createOvertureRoleRuntime(options: {
  readonly gateway: ModelGatewayPort;
  readonly binding: GatewayBinding;
  readonly policy: OvertureRoleRuntimePolicy;
  readonly modelRef?: string;
  readonly tools: ToolRegistry;
  readonly initialMessages?: readonly import("./model-provider.js").ModelMessage[];
  readonly closeGateway?: boolean;
  readonly onModelEvent?: (event: ModelStreamEvent, turnId: string) => void;
}): OvertureRoleRuntime {
  const modelRef = options.modelRef ?? `${options.binding.provider.provider}/${options.binding.provider.id}`;
  const grant: CapabilityGrant = {
    grantId: `overture-role-${options.policy.contextBoundary.runId}-${options.policy.roleId}`,
    allowedTools: [...options.policy.allowedTools],
    allowedSkills: [],
    modelPolicy: [modelRef],
    pathScope: [],
    outboundDataClasses: ["public", "workspace"],
    remaining: {
      modelTurns: 16,
      toolCalls: options.policy.allowedTools.length * 4,
      childCalls: 0,
      outputTokens: options.policy.outputTokenBudget,
      wallTimeMs: 300_000,
      retryCount: 0,
    },
  };
  const runtime = createMaestroAgentRuntime({
    gateway: options.gateway,
    binding: options.binding,
    tools: options.tools,
    systemPrompt: options.policy.systemPrompt,
    ...(options.initialMessages === undefined ? {} : { initialMessages: options.initialMessages }),
    ...(options.closeGateway === undefined ? {} : { closeGateway: options.closeGateway }),
    ...(options.onModelEvent === undefined ? {} : { onModelEvent: options.onModelEvent }),
  });
  return { runtime, grant };
}
