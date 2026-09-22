import type { GoalResult } from "@maestro/api-client";
import type { CommandCtx } from "./ctx.js";
import { nonNegativeInteger, printGoal, printState } from "./ctx.js";

export async function runGoalCommands(ctx: CommandCtx, resource: string | undefined, action: string | undefined): Promise<boolean> {
  if (resource === "goals" && action === "list") {
    const result = await ctx.client.listGoals(ctx.string("project-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "budget" && action === "get") {
    const result = await ctx.client.getBudgetSummary(ctx.string("goal-id"), { projectId: ctx.string("project-id") });
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "goal" && action === "create") {
    const contractId = ctx.value("contract-id");
    const result = await ctx.client.createGoal({ projectId: ctx.string("project-id"), ...(contractId === undefined ? {} : { contractId: ctx.string("contract-id") }) }, ctx.string("command-id"));
    printGoal(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "goal" && action === "get") {
    const result = await ctx.client.getGoal(ctx.string("goal-id"), { projectId: ctx.string("project-id") });
    printGoal(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "goal" && action === "transition") {
    const expectedVersion = nonNegativeInteger(ctx.string("expected-version"), "--expected-version");
    const result = await ctx.client.transitionGoal(ctx.string("goal-id"), { projectId: ctx.string("project-id"), expectedVersion, to: ctx.string("to") as GoalResult["state"] }, ctx.string("command-id"));
    printGoal(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "goal" && (action === "pause" || action === "stop" || action === "resume" || action === "emergency-stop")) {
    const input = { projectId: ctx.string("project-id"), expectedVersion: nonNegativeInteger(ctx.string("expected-version"), "--expected-version") };
    const commandId = ctx.string("command-id");
    const result = action === "pause"
      ? await ctx.client.pauseGoal(ctx.string("goal-id"), input, commandId)
      : action === "stop"
        ? await ctx.client.stopGoal(ctx.string("goal-id"), input, commandId)
        : action === "resume"
          ? await ctx.client.resumeGoal(ctx.string("goal-id"), input, commandId)
          : await ctx.client.emergencyStopGoal(ctx.string("goal-id"), input, commandId);
    printGoal(ctx.io.stdout, result, ctx.json);
    return true;
  }
  return false;
}
