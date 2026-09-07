import type { ApiClient, GoalResult } from "@maestro/api-client";
import type { WorkspaceSession } from "../session.js";
import { createCommandRegistry } from "./registry.js";
import type { ParsedCommand } from "./parser.js";

export type WorkspaceProject =
  | { kind: "attached"; projectId: string }
  | { kind: "unavailable"; reason: string };

export function discoverWorkspaceProject(workspacePath: string, session: WorkspaceSession | undefined): WorkspaceProject {
  if (session?.workspacePath !== workspacePath || session.projectId === undefined || session.projectId.trim() === "") {
    return { kind: "unavailable", reason: "No project is attached to this workspace" };
  }
  return { kind: "attached", projectId: session.projectId };
}

/**
 * Resolve a first-run workspace from the authenticated Control Plane identity.
 * A single visible project is safe to attach automatically; ambiguous or empty
 * results stay explicit so the TUI never guesses a project binding.
 */
export async function discoverWorkspaceProjectFromControlPlane(options: { workspacePath: string; session: WorkspaceSession | undefined; client: Pick<ApiClient, "listProjects"> }): Promise<WorkspaceProject> {
  const existing = discoverWorkspaceProject(options.workspacePath, options.session);
  try {
    const projects = (await options.client.listProjects()).projects;
    if (existing.kind === "attached" && projects.includes(existing.projectId)) return existing;
    if (projects.length === 1) return { kind: "attached", projectId: projects[0]! };
    if (projects.length === 0) return { kind: "unavailable", reason: "No projects are available for this operator" };
    return { kind: "unavailable", reason: `Multiple projects are available; choose one with /session attach --project-index=<1-${projects.length}>` };
  } catch (error) {
    return { kind: "unavailable", reason: `Project discovery unavailable: ${error instanceof Error ? error.message : "Control Plane request failed"}` };
  }
}

export interface DashboardReadModel {
  projectId: string;
  goals: GoalResult[];
  selectedGoal: GoalResult | undefined;
  budget: Awaited<ReturnType<ApiClient["getBudgetSummary"]>> | undefined;
  workerCount: number | undefined;
}

export async function readDashboard(options: { client: ApiClient; projectId: string; goalId?: string }): Promise<DashboardReadModel> {
  const goals = (await options.client.listGoals(options.projectId)).goals;
  const selectedGoal = options.goalId === undefined
    ? goals.find((goal) => ["active", "running", "pausing", "resuming"].includes(goal.state)) ?? goals[0]
    : goals.find((goal) => goal.goalId === options.goalId);
  if (selectedGoal === undefined) return { projectId: options.projectId, goals, selectedGoal: undefined, budget: undefined, workerCount: undefined };
  const [budget, workers] = await Promise.all([
    options.client.getBudgetSummary(selectedGoal.goalId, { projectId: options.projectId }),
    options.client.listWorkersForGoal(selectedGoal.goalId, { projectId: options.projectId }),
  ]);
  const activeStatuses = new Set(["spawned", "running"]);
  const activeWorkerCount = workers.workers.filter((worker) => activeStatuses.has(worker.status)).length;
  return { projectId: options.projectId, goals, selectedGoal, budget, workerCount: activeWorkerCount };
}


export interface ReadCommandContext {
  client: ApiClient;
  projectId: string;
  goalId?: string;
}

export interface ReadCommandResult {
  title: string;
  lines: string[];
}

const unavailable = (message: string): ReadCommandResult => ({ title: "Unavailable", lines: [message] });

function option(command: ParsedCommand, name: string): string | undefined {
  const value = command.options[name];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function required(command: ParsedCommand, name: string): string | ReadCommandResult {
  return option(command, name) ?? unavailable(`Missing required option --${name}`);
}

function selectedGoal(command: ParsedCommand, context: ReadCommandContext): string | ReadCommandResult {
  return option(command, "goal-id") ?? context.goalId ?? unavailable("No Goal is selected; use --goal-id or /goal select");
}

function valueLines<T>(title: string, items: readonly T[], format: (item: T) => string): ReadCommandResult {
  return { title, lines: items.length === 0 ? ["No records found."] : items.map(format) };
}

export async function executeReadCommand(context: ReadCommandContext, command: ParsedCommand): Promise<ReadCommandResult> {
  const key = `${command.name}:${command.action ?? ""}`;
  if (!["projects:list", "task-contract:get", "goals:list", "goal:get", "budget:get", "council:get", "department-plan:get", "mission-bundle:get", "worker:get", "worker:list", "workers:get", "workers:list", "git:status", "metronome-challenges:list", "encore-council:list", "certification:list", "certifications:list", "concertmaster-report:get", "events:list", "events:stream", "improvement-digests:list"].includes(key)) {
    const definition = createCommandRegistry().find(command.name);
    const action = definition?.actions.find((item) => item.name === command.action);
    if (action?.kind !== "read") return unavailable(`${command.name} ${command.action ?? ""} is a mutation; use the write command path`.trim());
    return unavailable(`${command.name} ${command.action ?? ""} is not available from this Control Plane client`);
  }

  if (key === "projects:list") {
    const projects = (await context.client.listProjects()).projects;
    return valueLines("Projects", projects, (projectId) => `• ${projectId}`);
  }
  if (key === "goals:list") {
    const goals = (await context.client.listGoals(context.projectId)).goals;
    return valueLines("Goals", goals, (goal) => `• ${goal.state} · v${goal.version} · ${goal.goalId}`);
  }
  if (key === "task-contract:get") {
    const contractId = required(command, "contract-id");
    if (typeof contractId !== "string") return contractId;
    const contract = await context.client.getTaskContract(contractId, { projectId: context.projectId });
    return { title: "Task Contract", lines: [`• ${contract.contractId} · ${contract.launchState} · v${contract.version}`] };
  }
  if (key === "council:get") {
    const councilId = required(command, "council-id");
    if (typeof councilId !== "string") return councilId;
    const council = await context.client.getCouncil(councilId, context.projectId);
    return { title: "Council", lines: [`• ${council.councilId} · ${council.state}`] };
  }
  if (key === "department-plan:get") {
    const councilId = required(command, "council-id");
    const departmentId = required(command, "department-id");
    if (typeof councilId !== "string") return councilId;
    if (typeof departmentId !== "string") return departmentId;
    const plan = await context.client.getDepartmentPlan(councilId, departmentId, context.projectId);
    return { title: "Department Plan", lines: [`• ${councilId}/${departmentId} · v${plan.version}`] };
  }
  if (key === "mission-bundle:get") {
    const councilId = required(command, "council-id");
    const departmentId = required(command, "department-id");
    const planVersion = required(command, "plan-version");
    const itemId = required(command, "item-id");
    if (typeof councilId !== "string") return councilId;
    if (typeof departmentId !== "string") return departmentId;
    if (typeof planVersion !== "string") return planVersion;
    if (typeof itemId !== "string") return itemId;
    const parsedPlanVersion = Number(planVersion);
    if (!Number.isSafeInteger(parsedPlanVersion) || parsedPlanVersion < 1) return unavailable("--plan-version must be a positive integer");
    const bundle = await context.client.getMissionBundle(councilId, departmentId, parsedPlanVersion, itemId, context.projectId);
    return { title: "Mission Bundle", lines: [`• ${councilId}/${departmentId}/${itemId} · v${bundle.planVersion} · ${bundle.contentHash}`] };
  }
  if (key === "goal:get") {
    const goalId = selectedGoal(command, context);
    if (typeof goalId !== "string") return goalId;
    const goal = await context.client.getGoal(goalId, { projectId: context.projectId });
    return { title: "Goal", lines: [`• ${goal.goalId} · ${goal.state} · v${goal.version}`] };
  }
  if (key === "budget:get") {
    const goalId = selectedGoal(command, context);
    if (typeof goalId !== "string") return goalId;
    const budget = await context.client.getBudgetSummary(goalId, { projectId: context.projectId });
    return { title: "Budget", lines: [`• ${budget.goalId} · spent ${budget.costCents}/${budget.budgetCents} cents · reserved ${budget.reservedCents}`] };
  }
  if (key === "events:list") {
    const page = await context.client.listEvents({ projectId: context.projectId, after: option(command, "after") ?? "0" });
    return { title: "Events", lines: page.events.length === 0 ? [`No events. Next cursor: ${page.nextCursor}`] : page.events.map((event) => `• ${event.cursor} · ${event.eventType} · ${event.goalId}`) };
  }
  if (key === "worker:list" || key === "workers:list") {
    const goalId = selectedGoal(command, context);
    if (typeof goalId !== "string") return goalId;
    const workers = await context.client.listWorkersForGoal(goalId, { projectId: context.projectId });
    return valueLines("Workers", workers.workers, (worker) => `• ${worker.workerId} · ${worker.status}`);
  }
  if (key === "events:stream") {
    return { title: "Events", lines: ["Live event stream is shown in the Activity timeline."] };
  }
  if (key === "worker:get" || key === "workers:get") {
    const workerId = required(command, "worker-id");
    if (typeof workerId !== "string") return workerId;
    const worker = await context.client.getWorker(workerId, context.projectId);
    return { title: "Worker", lines: [`• ${worker.workerId} · ${worker.status}`] };
  }
  if (key === "git:status") {
    const goalId = selectedGoal(command, context);
    if (typeof goalId !== "string") return goalId;
    const state = await context.client.getGitIntegrationState(goalId, { projectId: context.projectId });
    return { title: "Git", lines: [JSON.stringify(state)] };
  }
  if (key === "metronome-challenges:list") {
    const goalId = selectedGoal(command, context);
    if (typeof goalId !== "string") return goalId;
    const challenges = await context.client.listMetronomeChallenges(goalId, { projectId: context.projectId });
    return { title: "Metronome", lines: challenges.challenges.length === 0 ? ["No challenges found."] : challenges.challenges.map((challenge) => `• ${challenge.challengeId} · ${challenge.status}`) };
  }
  if (key === "encore-council:list") {
    const goalId = selectedGoal(command, context);
    if (typeof goalId !== "string") return goalId;
    const rounds = await context.client.listEncoreCouncilRounds(goalId, { projectId: context.projectId });
    return { title: "Encore", lines: rounds.rounds.length === 0 ? ["No Encore rounds found."] : rounds.rounds.map((round) => `• ${round.roundId}`) };
  }
  if (key === "certification:list" || key === "certifications:list") {
    const goalId = selectedGoal(command, context);
    if (typeof goalId !== "string") return goalId;
    const certifications = await context.client.listCertifications(goalId, { projectId: context.projectId });
    return { title: "Certifications", lines: certifications.certifications.length === 0 ? ["No certifications found."] : certifications.certifications.map((certification) => `• ${certification.certificationId} · ${certification.verdict}`) };
  }
  if (key === "concertmaster-report:get") {
    const goalId = selectedGoal(command, context);
    if (typeof goalId !== "string") return goalId;
    return { title: "Concertmaster report", lines: [JSON.stringify(await context.client.getConcertmasterReport(goalId, { projectId: context.projectId }))] };
  }
  if (key === "improvement-digests:list") {
    const goalId = selectedGoal(command, context);
    if (typeof goalId !== "string") return goalId;
    const digests = await context.client.listImprovementDigestsForGoal(goalId, { projectId: context.projectId });
    return { title: "Improvement digests", lines: digests.digests.length === 0 ? ["No improvement digests found."] : digests.digests.map((digest) => `• ${digest.digestId} · ${digest.trigger}`) };
  }

  return unavailable(`${key} is not yet wired to a read handler`);
}
