import type { CertifyWorkerInput } from "@maestro/contracts";
import type { CommandCtx } from "./ctx.js";
import { nonNegativeInteger, parseJsonOption, printState, safeInteger } from "./ctx.js";

export async function runExecutionCommands(ctx: CommandCtx, resource: string | undefined, action: string | undefined): Promise<boolean> {
  if (resource === "metronome" && action === "scan") {
    const result = await ctx.client.scanMetronome(ctx.string("goal-id"), { projectId: ctx.string("project-id") }, ctx.string("command-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "metronome" && action === "challenge") {
    const result = await ctx.client.raiseMetronomeChallenge(ctx.string("goal-id"), { projectId: ctx.string("project-id"), findingIds: parseJsonOption(ctx.string("finding-ids"), "--finding-ids"), reason: ctx.string("reason"), evidenceReferences: parseJsonOption(ctx.string("evidence-references"), "--evidence-references") }, ctx.string("command-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "metronome" && action === "correct") {
    const result = await ctx.client.requestMetronomeCorrection(ctx.string("challenge-id"), { projectId: ctx.string("project-id"), correctionRequest: ctx.string("correction-request") }, ctx.string("command-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "metronome" && action === "safe-pause") {
    const result = await ctx.client.requestMetronomeSafePause(ctx.string("goal-id"), ctx.string("challenge-id"), { projectId: ctx.string("project-id") }, ctx.string("command-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "metronome" && action === "resolve") {
    const result = await ctx.client.resolveMetronomeChallenge(ctx.string("challenge-id"), { projectId: ctx.string("project-id"), reason: ctx.string("reason") }, ctx.string("command-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "git" && action === "goal-branch") {
    const result = await ctx.client.createGoalIntegrationBranch(ctx.string("goal-id"), { projectId: ctx.string("project-id"), repositoryPath: ctx.string("repository-path"), branchName: ctx.string("branch-name"), baseRevision: ctx.string("base-revision") }, ctx.string("command-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "git" && action === "department-branch") {
    const result = await ctx.client.createDepartmentBranch(ctx.string("council-id"), ctx.string("department-id"), { projectId: ctx.string("project-id") }, ctx.string("command-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "git" && action === "worker-worktree") {
    const result = await ctx.client.createWorkerWorktree(ctx.string("worker-id"), { projectId: ctx.string("project-id"), worktreePath: ctx.string("worktree-path") }, ctx.string("command-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "git" && action === "worker-advance") {
    const result = await ctx.client.advanceWorkerIntegration(ctx.string("worker-id"), { projectId: ctx.string("project-id"), message: ctx.string("message"), evidenceReferences: parseJsonOption(ctx.string("evidence-references"), "--evidence-references") }, ctx.string("command-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "git" && action === "goal-revision") {
    const result = await ctx.client.freezeGoalIntegrationRevision(ctx.string("goal-id"), { projectId: ctx.string("project-id") }, ctx.string("command-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "git" && action === "status") {
    const result = await ctx.client.getGitIntegrationState(ctx.string("goal-id"), { projectId: ctx.string("project-id") });
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "workers" && action === "list") {
    const result = await ctx.client.listWorkersForGoal(ctx.string("goal-id"), { projectId: ctx.string("project-id") });
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "improvement-digests" && action === "list") {
    const result = await ctx.client.listImprovementDigestsForGoal(ctx.string("goal-id"), { projectId: ctx.string("project-id") });
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "worker" && action === "spawn") {
    const result = await ctx.client.spawnWorker(ctx.string("council-id"), ctx.string("department-id"), parseJsonOption(ctx.string("worker-json"), "--worker-json"), ctx.string("command-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "worker" && action === "message") {
    const result = await ctx.client.sendWorkerMessage(ctx.string("worker-id"), { projectId: ctx.string("project-id"), message: ctx.string("message") }, ctx.string("command-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "worker" && action === "get") {
    const result = await ctx.client.getWorker(ctx.string("worker-id"), ctx.string("project-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "worker" && action === "accept") {
    const result = await ctx.client.acceptWorker(ctx.string("worker-id"), { projectId: ctx.string("project-id"), reason: ctx.string("reason") }, ctx.string("command-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "worker" && (action === "certify" || action === "certify-conditional")) {
    const certification = parseJsonOption<Omit<CertifyWorkerInput, "projectId">>(ctx.string("certification-json"), "--certification-json");
    const input = { ...certification, projectId: ctx.string("project-id") };
    const result = action === "certify"
      ? await ctx.client.certifyWorker(ctx.string("worker-id"), input, ctx.string("command-id"))
      : await ctx.client.certifyConditionalWorker(ctx.string("worker-id"), ctx.string("certification-kind") as "security" | "safety_compliance", input, ctx.string("command-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "worker" && (action === "observe" || action === "cancel")) {
    const input = { projectId: ctx.string("project-id") };
    const result = action === "observe"
      ? await ctx.client.observeWorker(ctx.string("worker-id"), input, ctx.string("command-id"))
      : await ctx.client.cancelWorker(ctx.string("worker-id"), input, ctx.string("command-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "capability" && action === "select-full-access-mode") {
    const mode = ctx.string("full-access-mode");
    if (mode !== "retain_intermediate_approvals" && mode !== "skip_intermediate_approvals") throw new Error("--full-access-mode must be retain_intermediate_approvals or skip_intermediate_approvals");
    const result = await ctx.client.selectFullAccessMode(ctx.string("goal-id"), { projectId: ctx.string("project-id"), capabilityKind: ctx.string("capability-kind"), sessionId: ctx.string("session-id"), fullAccessMode: mode });
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "critical-action" && action === "request") {
    const result = await ctx.client.requestCriticalAction(ctx.string("goal-id"), {
      projectId: ctx.string("project-id"),
      action: ctx.string("action"),
      target: ctx.string("target"),
      policyVersion: nonNegativeInteger(ctx.string("version"), "--version"),
      budgetEffectCents: safeInteger(ctx.string("budget-effect-cents"), "--budget-effect-cents"),
    }, ctx.string("command-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  if (resource === "critical-action" && action === "approve-and-run") {
    const expiresAt = ctx.string("expires-at");
    const result = await ctx.client.approveAndRunCriticalAction(ctx.string("goal-id"), {
      projectId: ctx.string("project-id"),
      action: ctx.string("action"),
      target: ctx.string("target"),
      policyVersion: nonNegativeInteger(ctx.string("version"), "--version"),
      budgetEffectCents: safeInteger(ctx.string("budget-effect-cents"), "--budget-effect-cents"),
      expiresAt,
    }, ctx.string("command-id"));
    printState(ctx.io.stdout, result, ctx.json);
    return true;
  }
  return false;
}
