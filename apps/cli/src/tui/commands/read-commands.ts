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

function valueLines<T extends Record<string, unknown>>(title: string, items: readonly T[], format: (item: T) => string): ReadCommandResult {
  return { title, lines: items.length === 0 ? ["No records found."] : items.map(format) };
}

export async function executeReadCommand(context: ReadCommandContext, command: ParsedCommand): Promise<ReadCommandResult> {
  const key = `${command.name}:${command.action ?? ""}`;
  if (!["task-contract:get", "goals:list", "goal:get", "budget:get", "council:get", "department-plan:get", "mission-bundle:get", "worker:get", "worker:list", "workers:get", "workers:list", "git:status", "metronome-challenges:list", "encore-council:list", "certification:list", "certifications:list", "concertmaster-report:get", "events:list", "events:stream", "improvement-digests:list"].includes(key)) {
    const definition = createCommandRegistry().find(command.name);
    const action = definition?.actions.find((item) => item.name === command.action);
    if (action?.kind !== "read") return unavailable(`${command.name} ${command.action ?? ""} is a mutation; use the write command path`.trim());
    return unavailable(`${command.name} ${command.action ?? ""} is not available from this Control Plane client`);
  }

  if (key === "goals:list") {
    const goals = (await context.client.listGoals(context.projectId)).goals;
    return valueLines("Goals", goals, (goal) => `• ${goal.state} · v${goal.version} · ${goal.goalId}`);
  }
  if (key === "goal:get") {
    const goalId = required(command, "goal-id");
    if (typeof goalId !== "string") return goalId;
    const goal = await context.client.getGoal(goalId, { projectId: context.projectId });
    return { title: "Goal", lines: [`• ${goal.goalId} · ${goal.state} · v${goal.version}`] };
  }
  if (key === "budget:get") {
    const goalId = required(command, "goal-id");
    if (typeof goalId !== "string") return goalId;
    const budget = await context.client.getBudgetSummary(goalId, { projectId: context.projectId });
    return { title: "Budget", lines: [`• ${budget.goalId} · spent ${budget.costCents}/${budget.budgetCents} cents · reserved ${budget.reservedCents}`] };
  }
  if (key === "events:list") {
    const page = await context.client.listEvents({ projectId: context.projectId, after: option(command, "after") ?? "0" });
    return { title: "Events", lines: page.events.length === 0 ? [`No events. Next cursor: ${page.nextCursor}`] : page.events.map((event) => `• ${event.cursor} · ${event.eventType} · ${event.goalId}`) };
  }
  if (key === "worker:list" || key === "workers:list") {
    const goalId = required(command, "goal-id");
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
    const goalId = required(command, "goal-id");
    if (typeof goalId !== "string") return goalId;
    const state = await context.client.getGitIntegrationState(goalId, { projectId: context.projectId });
    return { title: "Git", lines: [JSON.stringify(state)] };
  }
  if (key === "metronome-challenges:list") {
    const goalId = required(command, "goal-id");
    if (typeof goalId !== "string") return goalId;
    const challenges = await context.client.listMetronomeChallenges(goalId, { projectId: context.projectId });
    return { title: "Metronome", lines: challenges.challenges.length === 0 ? ["No challenges found."] : challenges.challenges.map((challenge) => `• ${challenge.challengeId} · ${challenge.status}`) };
  }
  if (key === "encore-council:list") {
    const goalId = required(command, "goal-id");
    if (typeof goalId !== "string") return goalId;
    const rounds = await context.client.listEncoreCouncilRounds(goalId, { projectId: context.projectId });
    return { title: "Encore", lines: rounds.rounds.length === 0 ? ["No Encore rounds found."] : rounds.rounds.map((round) => `• ${round.roundId}`) };
  }
  if (key === "certification:list" || key === "certifications:list") {
    const goalId = required(command, "goal-id");
    if (typeof goalId !== "string") return goalId;
    const certifications = await context.client.listCertifications(goalId, { projectId: context.projectId });
    return { title: "Certifications", lines: certifications.certifications.length === 0 ? ["No certifications found."] : certifications.certifications.map((certification) => `• ${certification.certificationId} · ${certification.verdict}`) };
  }
  if (key === "concertmaster-report:get") {
    const goalId = required(command, "goal-id");
    if (typeof goalId !== "string") return goalId;
    return { title: "Concertmaster report", lines: [JSON.stringify(await context.client.getConcertmasterReport(goalId, { projectId: context.projectId }))] };
  }
  if (key === "improvement-digests:list") {
    const goalId = required(command, "goal-id");
    if (typeof goalId !== "string") return goalId;
    const digests = await context.client.listImprovementDigestsForGoal(goalId, { projectId: context.projectId });
    return { title: "Improvement digests", lines: digests.digests.length === 0 ? ["No improvement digests found."] : digests.digests.map((digest) => `• ${digest.digestId} · ${digest.trigger}`) };
  }

  return unavailable(`${key} is not yet wired to a read handler`);
}
