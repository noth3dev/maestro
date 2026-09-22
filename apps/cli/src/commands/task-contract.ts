import type { CommandCtx } from "./ctx.js";
import { nonNegativeInteger, parseJsonOption, printState } from "./ctx.js";

export async function runTaskContractCommands(ctx: CommandCtx, resource: string | undefined, action: string | undefined): Promise<boolean> {
  if (resource === "task-contract" && action === "create") {
    const result = await ctx.client.createTaskContract({ projectId: ctx.string("project-id"), substance: parseJsonOption(ctx.string("substance-json"), "--substance-json") }, ctx.string("contract-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "task-contract" && action === "get") {
    const result = await ctx.client.getTaskContract(ctx.string("contract-id"), { projectId: ctx.string("project-id") });
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "task-contract" && action === "amend") {
    const expectedVersion = nonNegativeInteger(ctx.string("expected-version"), "--expected-version");
    const result = await ctx.client.updateTaskContract(ctx.string("contract-id"), { projectId: ctx.string("project-id"), expectedVersion, substance: parseJsonOption(ctx.string("substance-json"), "--substance-json") }, ctx.value("command-id") === undefined ? undefined : ctx.string("command-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "task-contract" && action === "select-roles") {
    const result = await ctx.client.selectOvertureRoles(ctx.string("contract-id"), { projectId: ctx.string("project-id"), outsideEvidenceRequested: ctx.value("outside-evidence") === true, previewNeeded: ctx.value("preview-needed") === true }, ctx.value("command-id") === undefined ? undefined : ctx.string("command-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "task-contract" && action === "confirm") {
    const version = nonNegativeInteger(ctx.string("version"), "--version");
    await ctx.client.confirmTaskContract(ctx.string("contract-id"), { projectId: ctx.string("project-id"), version, contentHash: ctx.string("content-hash") }, ctx.value("command-id") === undefined ? undefined : ctx.string("command-id"));
    printState(ctx.io.stdout, { confirmed: true }, ctx.json);
    return true;
  }
  if (resource === "task-contract" && action === "launch") {
    const result = await ctx.client.launchTaskContract(ctx.string("contract-id"), ctx.string("project-id"), ctx.value("command-id") === undefined ? undefined : ctx.string("command-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  return false;
}
