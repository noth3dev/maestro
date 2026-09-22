import type { CapabilityGrant, InvocationContext } from "@maestro/domain";
import type { ModelToolCall, ModelToolDefinition, ToolResultStatus } from "../model-provider.js";

export interface ToolContext extends InvocationContext {
  readonly commandId: string;
  readonly toolCallId: string;
  readonly sessionId: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly sessionVersion: number;
  readonly controllerPolicyHash: string;
  readonly capabilityGrant: CapabilityGrant;
  readonly outboundDataPolicyHash: string;
}

export interface ToolExecutionResult {
  readonly status: ToolResultStatus;
  readonly content: string;
}

export interface ToolDefinition {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly inputSchema: { parse(value: unknown): unknown };
  readonly outputSchema: { parse(value: unknown): unknown };
  readonly modelInputSchema: unknown;
  readonly allowsParallel: boolean;
  readonly outboundDataClass: "public" | "workspace" | "private" | "pii" | "phi" | "secret";
  execute(args: unknown, context: ToolContext): Promise<ToolExecutionResult>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) throw new Error("duplicate tool name");
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  definitions(allowedTools: readonly string[]): readonly ModelToolDefinition[] {
    return allowedTools.flatMap((name) => {
      const tool = this.tools.get(name);
      if (tool === undefined) return [];
      return [
        {
          name: tool.name,
          version: tool.version,
          description: tool.description,
          inputSchema: tool.modelInputSchema,
          outputSchema: {},
          allowsParallel: tool.allowsParallel,
          outboundDataClass: tool.outboundDataClass,
        },
      ];
    });
  }

  async execute(call: ModelToolCall, context: ToolContext): Promise<ToolExecutionResult> {
    const tool = this.tools.get(call.name);
    if (tool === undefined) throw new Error("tool is not registered");
    if (call.arguments.state !== "valid") throw new Error("tool arguments are invalid");
    const parsed = tool.inputSchema.parse(call.arguments.value);
    const result = await tool.execute(parsed, context);
    tool.outputSchema.parse(result);
    return result;
  }
}
