import type { CommandCtx } from "./ctx.js";
import { parseJsonOption, printState } from "./ctx.js";

export async function runDeliberationCommands(ctx: CommandCtx, resource: string | undefined, action: string | undefined): Promise<boolean> {
  if (resource === "head" && action === "activate") {
    const result = await ctx.client.activateHead(ctx.string("goal-id"), parseJsonOption(ctx.string("activation-json"), "--activation-json"), ctx.string("command-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "council" && action === "create") {
    const result = await ctx.client.createCouncil(ctx.string("goal-id"), parseJsonOption(ctx.string("council-json"), "--council-json"), ctx.string("command-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "council" && action === "get") {
    const result = await ctx.client.getCouncil(ctx.string("council-id"), ctx.string("project-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "council" && action === "submit-brief") {
    await ctx.client.submitCouncilBrief(ctx.string("council-id"), ctx.string("department-id"), parseJsonOption(ctx.string("brief-json"), "--brief-json"), ctx.string("command-id"));
    printState(ctx.io.stdout, { submitted: true }, ctx.json);
    return true;
  }
  if (resource === "council" && action === "reveal") {
    await ctx.client.revealCouncil(ctx.string("council-id"), ctx.string("project-id"), ctx.string("command-id"));
    printState(ctx.io.stdout, { revealed: true }, ctx.json);
    return true;
  }
  if (resource === "council" && action === "decide") {
    const result = await ctx.client.decideCouncil(ctx.string("council-id"), parseJsonOption(ctx.string("packet-json"), "--packet-json"), ctx.string("command-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "department-plan" && action === "create") {
    const result = await ctx.client.createDepartmentPlan(ctx.string("council-id"), ctx.string("department-id"), parseJsonOption(ctx.string("plan-json"), "--plan-json"), ctx.string("command-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "department-plan" && action === "get") {
    const result = await ctx.client.getDepartmentPlan(ctx.string("council-id"), ctx.string("department-id"), ctx.string("project-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "mission-bundle" && action === "create") {
    const result = await ctx.client.createMissionBundle(ctx.string("council-id"), ctx.string("department-id"), ctx.string("item-id"), parseJsonOption(ctx.string("bundle-json"), "--bundle-json"), ctx.string("command-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "encore" && action === "review") {
    const result = await ctx.client.runEncoreReview(ctx.string("goal-id"), { ...parseJsonOption(ctx.string("review-json"), "--review-json"), projectId: ctx.string("project-id") }, ctx.string("command-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "mission-bundle" && action === "get") {
    const result = await ctx.client.getMissionBundle(ctx.string("council-id"), ctx.string("department-id"), Number(ctx.string("plan-version")), ctx.string("item-id"), ctx.string("project-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "department-plan" && action === "revise") {
    const result = await ctx.client.reviseDepartmentPlan(ctx.string("council-id"), ctx.string("department-id"), { ...parseJsonOption(ctx.string("plan-json"), "--plan-json"), reason: ctx.string("reason") }, ctx.string("command-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  return false;
}
