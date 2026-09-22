import type { CommandCtx } from "./ctx.js";
import { parseJsonOption, printState } from "./ctx.js";

export async function runAdminCommands(ctx: CommandCtx, resource: string | undefined, action: string | undefined): Promise<boolean> {
  if (resource === "admin" && action === "project-access") {
    const result = await ctx.client.provisionProjectAccess({ operatorId: ctx.string("operator-id"), projectId: ctx.string("project-id"), roles: parseJsonOption(ctx.string("roles-json"), "--roles-json") });
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  return false;
}
