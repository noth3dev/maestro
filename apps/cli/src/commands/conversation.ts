import type { CommandCtx } from "./ctx.js";
import { printState } from "./ctx.js";

export async function runConversationCommands(ctx: CommandCtx, resource: string | undefined, action: string | undefined): Promise<boolean> {
  if (resource === "models" && action === "list") {
    const result = await ctx.client.listModels();
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "conversation" && action === "create") {
    const result = await ctx.client.createConversation({ projectId: ctx.string("project-id"), goalId: ctx.string("goal-id"), model: ctx.string("model") });
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "conversation" && action === "get") {
    const result = await ctx.client.getConversation(ctx.string("conversation-id"), { projectId: ctx.string("project-id") });
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "conversation" && action === "turn") {
    const result = await ctx.client.sendConversationTurn(ctx.string("conversation-id"), { projectId: ctx.string("project-id"), text: ctx.string("text") });
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "conversation" && action === "cancel") {
    const result = await ctx.client.cancelConversation(ctx.string("conversation-id"), { projectId: ctx.string("project-id") });
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  return false;
}
