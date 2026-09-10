import { randomUUID } from "node:crypto";
import type { ApiClient } from "@maestro/api-client";
import {
  CertifyWorkerInputSchema,
  CreateDepartmentPlanInputSchema,
  CreateHeadCouncilInputSchema,
  CreateMissionBundleInputSchema,
  CreateTaskContractInputSchema,
  EncoreReviewInputSchema,
  HeadCouncilDecisionInputSchema,
  HeadParticipationInputSchema,
  ProjectAccessProvisionInputSchema,
  ReviseDepartmentPlanInputSchema,
  SpawnWorkerInputSchema,
  SubmitCouncilBriefInputSchema,
  TransitionGoalInputSchema,
  UpdateTaskContractInputSchema,
} from "@maestro/contracts";
import type { ParsedCommand } from "./parser.js";
import { createCommandRegistry } from "./registry.js";
import { confirmCriticalAction, type ConfirmationPrompt } from "../confirmation.js";

export interface WriteCommandContext {
  client: ApiClient;
  projectId: string;
  goalId?: string;
  confirm: ConfirmationPrompt;
}

export interface WriteCommandResult { title: string; lines: string[] }

const unavailable = (message: string): WriteCommandResult => ({ title: "Unavailable", lines: [message] });

function option(command: ParsedCommand, name: string): string | undefined {
  const value = command.options[name];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function required(command: ParsedCommand, name: string): string | WriteCommandResult {
  return option(command, name) ?? unavailable(`Missing required option --${name}`);
}

function selectedGoal(command: ParsedCommand, context: WriteCommandContext): string | WriteCommandResult {
  return option(command, "goal-id") ?? context.goalId ?? unavailable("No Goal is selected; use --goal-id or /goal select");
}

function integer(command: ParsedCommand, name: string): number | WriteCommandResult {
  const value = required(command, name);
  if (typeof value !== "string") return value;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : unavailable(`--${name} must be a non-negative integer`);
}

interface JsonSchema<T> {
  parse(value: unknown): T;
}

function jsonValue(command: ParsedCommand, name: string): unknown | WriteCommandResult {
  const raw = option(command, name);
  if (raw === undefined) return unavailable(`Missing required option --${name}`);
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed;
  } catch {
    return unavailable(`--${name} must contain valid JSON`);
  }
}

function parseInput<T>(name: string, value: unknown, schema: JsonSchema<T>): T | WriteCommandResult {
  try {
    return schema.parse(value);
  } catch {
    return unavailable(`--${name} does not match the expected input shape`);
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function jsonObject(command: ParsedCommand, name: string): Record<string, unknown> | WriteCommandResult {
  const value = jsonValue(command, name);
  if (isWriteError(value)) return value;
  if (!isJsonObject(value)) return unavailable(`--${name} must contain a JSON object`);
  return value;
}

function voidResult(title: string): WriteCommandResult { return { title, lines: ["Command accepted by Control Plane."] }; }

function isWriteError(value: unknown): value is WriteCommandResult {
  return typeof value === "object" && value !== null && "title" in value && typeof value.title === "string" && "lines" in value && Array.isArray(value.lines);
}


const supportedKeys = new Set([
  "admin:project-access", "task-contract:create", "task-contract:amend", "task-contract:select-roles", "task-contract:confirm", "task-contract:launch",
  "goal:create", "goal:transition", "goal:pause", "goal:stop", "goal:resume", "goal:emergency-stop", "head:activate",
  "council:create", "council:submit-brief", "council:reveal", "council:decide", "department-plan:create", "department-plan:revise", "mission-bundle:create",
  "worker:spawn", "worker:observe", "worker:cancel", "worker:accept", "worker:certify", "worker:certify-conditional", "certification:certify", "git:goal-branch", "git:department-branch", "git:worker-worktree", "git:goal-revision",
  "metronome:scan", "metronome:challenge", "metronome:correct", "metronome:safe-pause", "metronome:resolve", "encore:review", "approval:approve-and-run", "critical-action:request", "critical-action:approve-and-run",
]);

function flag(command: ParsedCommand, name: string): boolean { return command.options[name] === true || option(command, name) === "true"; }

function commandId(command: ParsedCommand): string { return option(command, "command-id") ?? randomUUID(); }
function result(title: string, value: { goalId?: string; state?: string; version?: number }): WriteCommandResult {
  const identity = value.goalId === undefined ? title : `Goal ${value.goalId}`;
  const details = value.state === undefined ? "completed" : `${value.state}${value.version === undefined ? "" : ` · v${value.version}`}`;
  return { title, lines: [`${identity} · ${details}`] };
}

async function confirmIfCritical(context: WriteCommandContext, command: ParsedCommand, target: string, identity: string): Promise<WriteCommandResult | undefined> {
  const definition = createCommandRegistry().find(command.name);
  const action = definition?.actions.find((item) => item.name === command.action);
  if (action?.kind !== "critical") return undefined;
  const actionName = `${command.name}.${command.action ?? ""}`.replace(/\.$/, "");
  const decision = await confirmCriticalAction({
    action: actionName,
    target,
    identity,
    ...((option(command, "goal-id") ?? context.goalId) === undefined ? {} : { goalId: option(command, "goal-id") ?? context.goalId }),
    effect: `Execute ${command.name} ${command.action ?? ""}`.trim(),
    expiresAt: option(command, "expires-at") ?? "server-defined",
    tier: "user",
    tierTrigger: "effect",
    effects: [{ classification: "critical", action: actionName, target, setsTier: true }],
    repetitionScope: "once",
    saferAlternative: "Prepare a dry-run or patch without applying this effect.",
  }, context.confirm);
  // The legacy critical-action endpoint only persists one command-bound approval.
  // Never pretend that a broader S5 scope was durable until S6 wires the
  // capability-approval service through the API.
  if (typeof decision === "object" && decision.repetitionScope !== "once") {
    return { title: "Unavailable", lines: [`Approval scope ${decision.repetitionScope} is not persisted by this execution path; no mutation was sent.`] };
  }
  const approved = typeof decision === "object" ? decision.decision : decision;
  return approved === "cancelled" ? { title: "Cancelled", lines: ["No mutation was sent."] } : undefined;
}

export async function executeWriteCommand(context: WriteCommandContext, command: ParsedCommand): Promise<WriteCommandResult> {
  const definition = createCommandRegistry().find(command.name);
  const action = definition?.actions.find((item) => item.name === command.action);
  if (action === undefined) return unavailable(`Unknown command: ${command.name} ${command.action ?? ""}`.trim());
  if (action.kind === "read") return unavailable(`${command.name} ${command.action ?? ""} is a read; use the read command path`.trim());
  const key = `${command.name}:${command.action ?? ""}`;
  if (!supportedKeys.has(key)) return unavailable(`${key} is not available from the typed Control Plane client`);
  // A local keypress is not a durable CEO approval. Until a critical operation
  // has a server-side approve-and-run binding, fail closed before prompting or
  // invoking any mutation-capable client method.
  const serverAuthorizedSafetyKeys = new Set(["goal:emergency-stop", "metronome:safe-pause"]);
  if (action.kind === "critical" && key !== "approval:approve-and-run" && key !== "critical-action:approve-and-run" && !serverAuthorizedSafetyKeys.has(key)) {
    return unavailable("Critical action requires the durable Control Plane approval path; no mutation was sent.");
  }

  const target = option(command, "target") ?? option(command, "goal-id") ?? context.goalId ?? context.projectId;
  const id = commandId(command);
  const cancelled = await confirmIfCritical(context, command, target, id);
  if (cancelled !== undefined) return cancelled;

  if (command.name === "goal" && command.action === "create") {
    const contractId = option(command, "contract-id");
    const created = await context.client.createGoal({ projectId: context.projectId, ...(contractId === undefined ? {} : { contractId }) }, id);
    return result("Goal", created);
  }
  if (command.name === "goal" && command.action === "transition") {
    const goalId = selectedGoal(command, context); const expectedVersion = integer(command, "expected-version"); const to = required(command, "to");
    if (typeof goalId !== "string") return goalId;
    if (typeof expectedVersion !== "number") return expectedVersion;
    if (typeof to !== "string") return to;
    const input = parseInput("to", { projectId: context.projectId, expectedVersion, to }, TransitionGoalInputSchema);
    if (isWriteError(input)) return input;
    const updated = await context.client.transitionGoal(goalId, input, id);
    return result("Goal", updated);
  }
  if (command.name === "goal" && ["pause", "stop", "resume", "emergency-stop"].includes(command.action ?? "")) {
    const goalId = selectedGoal(command, context); const expectedVersion = integer(command, "expected-version");
    if (typeof goalId !== "string") return goalId;
    if (typeof expectedVersion !== "number") return expectedVersion;
    const input = { projectId: context.projectId, expectedVersion };
    const updated = command.action === "pause" ? await context.client.pauseGoal(goalId, input, id)
      : command.action === "stop" ? await context.client.stopGoal(goalId, input, id)
        : command.action === "resume" ? await context.client.resumeGoal(goalId, input, id)
          : await context.client.emergencyStopGoal(goalId, input, id);
    return result("Goal", updated);
  }
  if (command.name === "metronome" && command.action === "safe-pause") {
    const goalId = selectedGoal(command, context); const challengeId = required(command, "challenge-id");
    if (typeof goalId !== "string") return goalId;
    if (typeof challengeId !== "string") return challengeId;
    const updated = await context.client.requestMetronomeSafePause(goalId, challengeId, { projectId: context.projectId }, id);
    return { title: "Metronome", lines: [`${updated.challengeId} · ${updated.status}`] };
  }

  if (key === "critical-action:request") {
    const goalId = selectedGoal(command, context);
    const actionName = required(command, "action");
    const target = required(command, "target");
    const policyVersion = integer(command, "policy-version");
    const budgetEffectCents = integer(command, "budget-effect-cents");
    if (typeof goalId !== "string") return goalId;
    if (typeof actionName !== "string") return actionName;
    if (typeof target !== "string") return target;
    if (typeof policyVersion !== "number") return policyVersion;
    if (typeof budgetEffectCents !== "number") return budgetEffectCents;
    const requested = await context.client.requestCriticalAction(goalId, { projectId: context.projectId, action: actionName, target, policyVersion, budgetEffectCents }, id);
    return { title: "Critical action", lines: [`${requested.effect} · ${requested.classification} · ${requested.reason}`] };
  }
  if (key === "admin:project-access") {
    const operatorId = required(command, "operator-id"); const roles = option(command, "roles-json");
    if (typeof operatorId !== "string") return operatorId;
    if (roles === undefined) return unavailable("Missing required option --roles-json");
    let parsedRoles: unknown;
    try { parsedRoles = JSON.parse(roles); } catch { return unavailable("--roles-json must contain valid JSON"); }
    const input = parseInput(
      "roles-json",
      { operatorId, projectId: context.projectId, roles: parsedRoles },
      ProjectAccessProvisionInputSchema
    );
    if (isWriteError(input)) return input;
    const provisioned = await context.client.provisionProjectAccess(input);
    return { title: "Project access", lines: [JSON.stringify(provisioned)] };
  }
  if (key === "task-contract:create") {
    const contractId = required(command, "contract-id"); const substance = jsonObject(command, "substance-json");
    if (typeof contractId !== "string") return contractId; if (isWriteError(substance)) return substance;
    const input = parseInput("substance-json", { projectId: context.projectId, substance }, CreateTaskContractInputSchema);
    if (isWriteError(input)) return input;
    const created = await context.client.createTaskContract(input, contractId);
    return { title: "Task Contract", lines: [`${created.contractId} · ${created.launchState}`] };
  }
  if (key === "task-contract:amend") {
    const contractId = required(command, "contract-id"); const expectedVersion = integer(command, "expected-version"); const substance = jsonObject(command, "substance-json");
    if (typeof contractId !== "string") return contractId; if (typeof expectedVersion !== "number") return expectedVersion; if (isWriteError(substance)) return substance;
    const input = parseInput("substance-json", { projectId: context.projectId, expectedVersion, substance }, UpdateTaskContractInputSchema);
    if (isWriteError(input)) return input;
    const updated = await context.client.updateTaskContract(contractId, input, id);
    return { title: "Task Contract", lines: [`${updated.contractId} · v${updated.version}`] };
  }
  if (key === "task-contract:select-roles") {
    const contractId = required(command, "contract-id"); if (typeof contractId !== "string") return contractId;
    const selected = await context.client.selectOvertureRoles(contractId, { projectId: context.projectId, outsideEvidenceRequested: flag(command, "outside-evidence"), previewNeeded: flag(command, "preview-needed") }, id);
    return { title: "Overture roles", lines: [selected.roles.join(", ")] };
  }
  if (key === "task-contract:confirm") {
    const contractId = required(command, "contract-id"); const version = integer(command, "version"); const contentHash = required(command, "content-hash");
    if (typeof contractId !== "string") return contractId; if (typeof version !== "number") return version; if (typeof contentHash !== "string") return contentHash;
    await context.client.confirmTaskContract(contractId, { projectId: context.projectId, version, contentHash }, id); return voidResult("Task Contract");
  }
  if (key === "task-contract:launch") {
    const contractId = required(command, "contract-id"); if (typeof contractId !== "string") return contractId;
    const launched = await context.client.launchTaskContract(contractId, context.projectId, id); return { title: "Task Contract", lines: [`${launched.contractId} · ${launched.launchState}`] };
  }
  if (key === "head:activate") {
    const goalId = selectedGoal(command, context); const activation = jsonObject(command, "activation-json");
    if (typeof goalId !== "string") return goalId; if (isWriteError(activation)) return activation;
    const input = parseInput("activation-json", { ...activation, projectId: context.projectId }, HeadParticipationInputSchema);
    if (isWriteError(input)) return input;
    const activated = await context.client.activateHead(goalId, input, id);
    return { title: "Head", lines: [`${activated.departmentId} · ${activated.status}`] };
  }
  if (key === "council:create") {
    const goalId = selectedGoal(command, context); const council = jsonObject(command, "council-json");
    if (typeof goalId !== "string") return goalId; if (isWriteError(council)) return council;
    const input = parseInput("council-json", { ...council, projectId: context.projectId }, CreateHeadCouncilInputSchema);
    if (isWriteError(input)) return input;
    const created = await context.client.createCouncil(goalId, input, id);
    return { title: "Council", lines: [`${created.councilId} · ${created.state}`] };
  }
  if (key === "council:submit-brief") {
    const councilId = required(command, "council-id"); const departmentId = required(command, "department-id"); const brief = jsonObject(command, "brief-json");
    if (typeof councilId !== "string") return councilId; if (typeof departmentId !== "string") return departmentId; if (isWriteError(brief)) return brief;
    const input = parseInput("brief-json", { projectId: context.projectId, brief }, SubmitCouncilBriefInputSchema);
    if (isWriteError(input)) return input;
    await context.client.submitCouncilBrief(councilId, departmentId, input, id); return voidResult("Council brief");
  }
  if (key === "council:reveal") {
    const councilId = required(command, "council-id"); if (typeof councilId !== "string") return councilId;
    await context.client.revealCouncil(councilId, context.projectId, id); return voidResult("Council");
  }
  if (key === "council:decide") {
    const councilId = required(command, "council-id"); const packet = jsonObject(command, "packet-json");
    if (typeof councilId !== "string") return councilId; if (isWriteError(packet)) return packet;
    const input = parseInput("packet-json", { projectId: context.projectId, packet }, HeadCouncilDecisionInputSchema);
    if (isWriteError(input)) return input;
    const decided = await context.client.decideCouncil(councilId, input, id); return { title: "Council", lines: [`${decided.councilId} · ${decided.state}`] };
  }
  if (key === "department-plan:create") {
    const councilId = required(command, "council-id"); const departmentId = required(command, "department-id"); const plan = jsonObject(command, "plan-json");
    if (typeof councilId !== "string") return councilId; if (typeof departmentId !== "string") return departmentId; if (isWriteError(plan)) return plan;
    const input = parseInput("plan-json", { projectId: context.projectId, substance: plan }, CreateDepartmentPlanInputSchema);
    if (isWriteError(input)) return input;
    const created = await context.client.createDepartmentPlan(councilId, departmentId, input, id); return { title: "Department Plan", lines: [`version ${created.version}`] };
  }
  if (key === "department-plan:revise") {
    const councilId = required(command, "council-id"); const departmentId = required(command, "department-id"); const plan = jsonObject(command, "plan-json"); const reason = required(command, "reason");
    if (typeof councilId !== "string") return councilId; if (typeof departmentId !== "string") return departmentId; if (typeof reason !== "string") return reason; if (isWriteError(plan)) return plan;
    const input = parseInput(
      "plan-json", { projectId: context.projectId, expectedVersion: Number(option(command, "expected-version") ?? "0"), substance: plan, reason },
      ReviseDepartmentPlanInputSchema
    );
    if (isWriteError(input)) return input;
    const revised = await context.client.reviseDepartmentPlan(councilId, departmentId, input, id); return { title: "Department Plan", lines: [`version ${revised.version}`] };
  }
  if (key === "mission-bundle:create") {
    const councilId = required(command, "council-id"); const departmentId = required(command, "department-id"); const itemId = required(command, "item-id"); const bundle = jsonObject(command, "bundle-json");
    if (typeof councilId !== "string") return councilId; if (typeof departmentId !== "string") return departmentId; if (typeof itemId !== "string") return itemId; if (isWriteError(bundle)) return bundle;
    const input = parseInput("bundle-json", { projectId: context.projectId, substance: bundle }, CreateMissionBundleInputSchema);
    if (isWriteError(input)) return input;
    const created = await context.client.createMissionBundle(councilId, departmentId, itemId, input, id); return { title: "Mission Bundle", lines: [created.contentHash] };
  }
  if (key === "worker:spawn") {
    const councilId = required(command, "council-id"); const departmentId = required(command, "department-id"); const worker = jsonObject(command, "worker-json");
    if (typeof councilId !== "string") return councilId; if (typeof departmentId !== "string") return departmentId; if (isWriteError(worker)) return worker;
    const input = parseInput("worker-json", { ...worker, projectId: context.projectId }, SpawnWorkerInputSchema);
    if (isWriteError(input)) return input;
    const spawned = await context.client.spawnWorker(councilId, departmentId, input, id); return { title: "Worker", lines: [`${spawned.workerId} · ${spawned.status}`] };
  }
  if (key === "worker:observe" || key === "worker:cancel") {
    const workerId = required(command, "worker-id"); if (typeof workerId !== "string") return workerId;
    const observed = key.endsWith("observe") ? await context.client.observeWorker(workerId, { projectId: context.projectId }, id) : await context.client.cancelWorker(workerId, { projectId: context.projectId }, id);
    return { title: "Worker", lines: [`${observed.workerId} · ${observed.status}`] };
  }
  if (key === "worker:accept") {
    const workerId = required(command, "worker-id"); const reason = required(command, "reason"); if (typeof workerId !== "string") return workerId; if (typeof reason !== "string") return reason;
    const accepted = await context.client.acceptWorker(workerId, { projectId: context.projectId, reason }, id); return { title: "Worker acceptance", lines: [JSON.stringify(accepted)] };
  }
  if (key === "worker:certify" || key === "certification:certify") {
    const workerId = required(command, "worker-id"); const certification = jsonObject(command, "certification-json"); if (typeof workerId !== "string") return workerId; if (isWriteError(certification)) return certification;
    const input = parseInput("certification-json", { ...certification, projectId: context.projectId }, CertifyWorkerInputSchema);
    if (isWriteError(input)) return input;
    const certified = await context.client.certifyWorker(workerId, input, id); return { title: "Certification", lines: [JSON.stringify(certified)] };
  }
  if (key === "worker:certify-conditional") {
    const workerId = required(command, "worker-id"); const kind = option(command, "kind"); const certification = jsonObject(command, "certification-json");
    if (typeof workerId !== "string") return workerId; if (kind !== "security" && kind !== "safety_compliance") return unavailable("--kind must be security or safety_compliance"); if (isWriteError(certification)) return certification;
    const input = parseInput("certification-json", { ...certification, projectId: context.projectId }, CertifyWorkerInputSchema);
    if (isWriteError(input)) return input;
    const certified = await context.client.certifyConditionalWorker(workerId, kind, input, id); return { title: "Certification", lines: [JSON.stringify(certified)] };
  }
  if (key === "git:goal-branch") {
    const goalId = selectedGoal(command, context); const repositoryPath = required(command, "repository-path"); const branchName = required(command, "branch-name"); const baseRevision = required(command, "base-revision");
    if (typeof goalId !== "string") return goalId; if (typeof repositoryPath !== "string") return repositoryPath; if (typeof branchName !== "string") return branchName; if (typeof baseRevision !== "string") return baseRevision;
    const branch = await context.client.createGoalIntegrationBranch(goalId, { projectId: context.projectId, repositoryPath, branchName, baseRevision }, id); return { title: "Git", lines: [`${branch.branchName} · ${branch.baseRevision}`] };
  }
  if (key === "git:department-branch") {
    const councilId = required(command, "council-id"); const departmentId = required(command, "department-id"); if (typeof councilId !== "string") return councilId; if (typeof departmentId !== "string") return departmentId;
    const branch = await context.client.createDepartmentBranch(councilId, departmentId, { projectId: context.projectId }, id); return { title: "Git", lines: [branch.branchName] };
  }
  if (key === "git:worker-worktree") {
    const workerId = required(command, "worker-id"); const worktreePath = required(command, "worktree-path"); if (typeof workerId !== "string") return workerId; if (typeof worktreePath !== "string") return worktreePath;
    const worktree = await context.client.createWorkerWorktree(workerId, { projectId: context.projectId, worktreePath }, id); return { title: "Git", lines: [worktree.worktreePath] };
  }
  if (key === "git:goal-revision") {
    const goalId = selectedGoal(command, context); if (typeof goalId !== "string") return goalId;
    const revision = await context.client.freezeGoalIntegrationRevision(goalId, { projectId: context.projectId }, id); return { title: "Git", lines: [revision.commitSha] };
  }
  if (key === "metronome:scan") {
    const goalId = selectedGoal(command, context); if (typeof goalId !== "string") return goalId;
    const findings = await context.client.scanMetronome(goalId, { projectId: context.projectId }, id); return { title: "Metronome", lines: [`findings: ${findings.findings.length}`] };
  }
  if (key === "metronome:challenge") {
    const goalId = selectedGoal(command, context); const reason = required(command, "reason"); const findingIds = jsonValue(command, "finding-ids"); const evidence = jsonValue(command, "evidence-references");
    if (typeof goalId !== "string") return goalId; if (typeof reason !== "string") return reason; if (isWriteError(findingIds)) return findingIds as WriteCommandResult; if (isWriteError(evidence)) return evidence as WriteCommandResult;
    if (!Array.isArray(findingIds) || !findingIds.every((item) => typeof item === "string")) return unavailable("--finding-ids must contain a JSON array"); if (!Array.isArray(evidence) || !evidence.every((item) => typeof item === "string")) return unavailable("--evidence-references must contain a JSON array");
    const challenge = await context.client.raiseMetronomeChallenge(goalId, { projectId: context.projectId, reason, findingIds, evidenceReferences: evidence }, id); return { title: "Metronome", lines: [`${challenge.challengeId} · ${challenge.status}`] };
  }
  if (key === "metronome:correct") {
    const challengeId = required(command, "challenge-id"); const correctionRequest = required(command, "correction-request"); if (typeof challengeId !== "string") return challengeId; if (typeof correctionRequest !== "string") return correctionRequest;
    const corrected = await context.client.requestMetronomeCorrection(challengeId, { projectId: context.projectId, correctionRequest }, id); return { title: "Metronome", lines: [`${corrected.challengeId} · ${corrected.status}`] };
  }
  if (key === "metronome:safe-pause") {
    const goalId = selectedGoal(command, context); const challengeId = required(command, "challenge-id"); if (typeof goalId !== "string") return goalId; if (typeof challengeId !== "string") return challengeId;
    const paused = await context.client.requestMetronomeSafePause(goalId, challengeId, { projectId: context.projectId }, id); return { title: "Metronome", lines: [`${paused.challengeId} · ${paused.status}`] };
  }
  if (key === "metronome:resolve") {
    const challengeId = required(command, "challenge-id"); const reason = required(command, "reason"); if (typeof challengeId !== "string") return challengeId; if (typeof reason !== "string") return reason;
    const resolved = await context.client.resolveMetronomeChallenge(challengeId, { projectId: context.projectId, reason }, id); return { title: "Metronome", lines: [`${resolved.challengeId} · ${resolved.status}`] };
  }
  if (key === "encore:review") {
    const goalId = selectedGoal(command, context); const review = jsonObject(command, "review-json"); if (typeof goalId !== "string") return goalId; if (isWriteError(review)) return review;
    const input = parseInput("review-json", { ...review, projectId: context.projectId }, EncoreReviewInputSchema);
    if (isWriteError(input)) return input;
    const reviewed = await context.client.runEncoreReview(goalId, input, id); return { title: "Encore", lines: [JSON.stringify(reviewed)] };
  }
  if (key === "approval:approve-and-run" || key === "critical-action:approve-and-run") {
    const goalId = selectedGoal(command, context); const actionName = required(command, "action"); const targetName = required(command, "target"); const version = integer(command, "version"); const budgetEffectCents = integer(command, "budget-effect-cents"); const expiresAt = required(command, "expires-at");
    if (typeof goalId !== "string") return goalId; if (typeof actionName !== "string") return actionName; if (typeof targetName !== "string") return targetName; if (typeof version !== "number") return version; if (typeof budgetEffectCents !== "number") return budgetEffectCents; if (typeof expiresAt !== "string") return expiresAt;
    const decision = await context.client.approveAndRunCriticalAction(goalId, { projectId: context.projectId, action: actionName, target: targetName, policyVersion: version, budgetEffectCents, expiresAt }, id); return { title: "Critical action", lines: [`${decision.effect} · ${decision.reason}`] };
  }
  return unavailable(`${command.name} ${command.action ?? ""} is not yet wired to a typed write handler`.trim());
}
