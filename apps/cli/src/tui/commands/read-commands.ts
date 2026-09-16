import { CHANNEL_SELECTORS, type ApiClient, type ChannelRead, type ChannelSelector, type GoalResult } from "@maestro/api-client";
import { ChannelSelectorSchema } from "@maestro/contracts";
import { renderChannelList, renderChannelPanel } from "../panels/channel-panel.js";
import type { WorkspaceSession } from "../session.js";
import { renderBillingPanel } from "../panels/billing-panel.js";
import { renderLuthieryPanel } from "../panels/luthiery-panel.js";
import { renderProjectionPanel, type ProjectionPanelValue } from "../panels/projection-panel.js";
import { renderTaskContractPanel } from "../panels/task-contract-panel.js";
import { renderCouncilPanel } from "../panels/council-panel.js";
import { renderDepartmentPlanPanel } from "../panels/department-plan-panel.js";
import { renderWorkerPanel } from "../panels/worker-panel.js";
import { renderMetronomePanel } from "../panels/metronome-panel.js";
import { renderEncorePanel } from "../panels/encore-panel.js";
import { renderCertificationPanel } from "../panels/certification-panel.js";
import { renderBudgetPanel } from "../panels/budget-panel.js";
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
    const attachCommands = projects.map((_, index) => `/session attach --project-index=${index + 1}`).join(" or ");
    return { kind: "unavailable", reason: `Multiple projects are available; choose one: ${attachCommands}` };
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

export const TUI_READ_COMMAND_KEYS = new Set([
  "projects:list", "projection:read", "task-contract:get", "goals:list", "goal:get", "budget:get", "billing:get", "luthiery:list",
  "council:get", "department-plan:get", "mission-bundle:get", "worker:get", "worker:list", "workers:get", "workers:list",
  "git:status", "metronome-challenges:list", "encore-council:list", "certification:list", "certifications:list",
  "concertmaster-report:get", "evidence:list", "evidence:bundle", "events:list", "events:stream", "improvement-digests:list", "conversation:get",
  "channel:list", "channel:read",
]);

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

function channelSelector(command: ParsedCommand): ChannelSelector | ReadCommandResult {
  const kind = required(command, "channel-kind");
  const channelId = required(command, "channel-id");
  if (typeof kind !== "string") return kind;
  if (typeof channelId !== "string") return channelId;
  const parsed = ChannelSelectorSchema.safeParse({ kind, channelId });
  return parsed.success ? parsed.data : unavailable("--channel-kind and --channel-id do not identify a valid channel");
}

async function listChannels(context: ReadCommandContext, goalId: string): Promise<ChannelRead[]> {
  const results = await Promise.allSettled(CHANNEL_SELECTORS.map((selector) => context.client.getChannel(goalId, selector, { projectId: context.projectId })));
  return results
    .filter((result): result is PromiseFulfilledResult<ChannelRead> => result.status === "fulfilled")
    .map((result) => result.value)
    .filter((read) => read.members.length > 0);
}

function valueLines<T>(title: string, items: readonly T[], format: (item: T) => string): ReadCommandResult {
  return { title, lines: items.length === 0 ? ["No records found."] : items.map(format) };
}

function contentRecords(content: Record<string, unknown>): readonly Record<string, unknown>[] {
  const records = content.evidenceRecords;
  if (!Array.isArray(records)) return [];
  return records.filter((record): record is Record<string, unknown> => record !== null && typeof record === "object" && !Array.isArray(record));
}

function recordField(record: Record<string, unknown>, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
}

function formatEvidenceRecord(record: Record<string, unknown>): string {
  const id = recordField(record, "evidenceId", "evidence_id") ?? "unknown-id";
  const kind = recordField(record, "kind") ?? "unknown-kind";
  const createdAt = recordField(record, "createdAt", "created_at");
  return `• ${id} · ${kind}${createdAt === undefined ? "" : ` · ${createdAt}`}`;
}

export async function executeReadCommand(context: ReadCommandContext, command: ParsedCommand): Promise<ReadCommandResult> {
  const key = `${command.name}:${command.action ?? ""}`;
  if (!TUI_READ_COMMAND_KEYS.has(key)) {
    const definition = createCommandRegistry().find(command.name);
    const action = definition?.actions.find((item) => item.name === command.action);
    if (action?.kind !== "read") return unavailable(`${command.name} ${command.action ?? ""} is a mutation; use the write command path`.trim());
    return unavailable(`${command.name} ${command.action ?? ""} is not available from this Control Plane client`);
  }

  if (key === "projects:list") {
    const projects = (await context.client.listProjects()).projects;
    return valueLines("Projects", projects, (projectId) => `• ${projectId}`);
  }
  if (key === "projection:read") {
    const goalId = option(command, "goal-id");
    const projection = await context.client.getProjection(goalId === undefined ? { projectId: context.projectId } : { projectId: context.projectId, goalId });
    const organization = await context.client.getOrganization();
    const value = { projection, organization } as ProjectionPanelValue;
    const departmentId = option(command, "department-id");
    const groupId = option(command, "group-id");
    const headId = option(command, "head-id");
    if (departmentId !== undefined) value.departmentId = departmentId;
    if (groupId !== undefined) value.groupId = groupId;
    if (headId !== undefined) value.headId = headId;
    const rendered = renderProjectionPanel({ kind: "value", value }, 120);
    return { title: rendered[0] ?? "Organization projection", lines: rendered.slice(1) };
  }
  if (key === "channel:list") {
    const goalId = selectedGoal(command, context);
    if (typeof goalId !== "string") return goalId;
    return { title: "Channels", lines: renderChannelList(await listChannels(context, goalId), 120).slice(1) };
  }
  if (key === "channel:read") {
    const goalId = selectedGoal(command, context);
    const selector = channelSelector(command);
    if (typeof goalId !== "string") return goalId;
    if ("title" in selector) return selector;
    const read = await context.client.getChannel(goalId, selector, { projectId: context.projectId });
    const rendered = renderChannelPanel(read, 120);
    return { title: rendered[0] ?? "Channel", lines: rendered.slice(1) };
  }
  if (key === "billing:get") {
    const billing = await context.client.getBillingSummary(context.projectId);
    const rendered = renderBillingPanel({ kind: "value", value: billing }, 120);
    return { title: rendered[0] ?? "Billing", lines: rendered.slice(1) };
  }
  if (key === "luthiery:list") {
    const registry = option(command, "registry") ?? "skills";
    if (registry !== "skills" && registry !== "tools") return unavailable("--registry must be either skills or tools");
    const rendered = renderLuthieryPanel({ kind: "unavailable", registry }, 120);
    return { title: rendered[0] ?? "Luthiery", lines: rendered.slice(1) };
  }
  if (key === "goals:list") {
    const goals = (await context.client.listGoals(context.projectId)).goals;
    return valueLines("Goals", goals, (goal) => `• ${goal.state} · v${goal.version} · ${goal.goalId}`);
  }
  if (key === "task-contract:get") {
    const contractId = required(command, "contract-id");
    if (typeof contractId !== "string") return contractId;
    const contract = await context.client.getTaskContract(contractId, { projectId: context.projectId });
    const rendered = renderTaskContractPanel({ kind: "value", value: contract }, 120);
    return { title: rendered[0]!, lines: rendered.slice(1) };
  }
  if (key === "conversation:get") {
    const conversationId = required(command, "conversation-id");
    if (typeof conversationId !== "string") return conversationId;
    const conversation = await context.client.getConversation(conversationId, { projectId: context.projectId });
    return { title: "Conversation", lines: [`• ${conversation.conversationId} · ${conversation.status} · v${conversation.version} · ${conversation.model}`] };
  }
  if (key === "council:get") {
    const councilId = required(command, "council-id");
    if (typeof councilId !== "string") return councilId;
    const council = await context.client.getCouncil(councilId, context.projectId);
    const rendered = renderCouncilPanel({ kind: "value", value: council }, 120);
    return { title: rendered[0]!, lines: rendered.slice(1) };
  }
  if (key === "department-plan:get") {
    const councilId = required(command, "council-id");
    const departmentId = required(command, "department-id");
    if (typeof councilId !== "string") return councilId;
    if (typeof departmentId !== "string") return departmentId;
    const plan = await context.client.getDepartmentPlan(councilId, departmentId, context.projectId);
    const rendered = renderDepartmentPlanPanel({ kind: "value", value: plan }, 120);
    return { title: rendered[0]!, lines: rendered.slice(1) };
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
    const rendered = renderBudgetPanel({ kind: "value", value: budget }, 120);
    return { title: rendered[0]!, lines: rendered.slice(1) };
  }
  if (key === "evidence:list" || key === "evidence:bundle") {
    const goalId = selectedGoal(command, context);
    if (typeof goalId !== "string") return goalId;
    const bundle = await context.client.getEvidenceBundle(goalId, { projectId: context.projectId });
    const content = bundle.content as Record<string, unknown>;
    const records = contentRecords(content);
    if (key === "evidence:list") return valueLines("Evidence", records, formatEvidenceRecord);
    const lines = [`• ${bundle.bundleId} · ${bundle.hash}`];
    for (const [name, value] of Object.entries(content)) lines.push(`• ${name}: ${JSON.stringify(value)}`);
    return { title: "Evidence bundle", lines };
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
    const rendered = renderWorkerPanel({ kind: "value", value: worker }, 120);
    return { title: rendered[0]!, lines: rendered.slice(1) };
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
    const rendered = renderMetronomePanel({ kind: "value", value: challenges.challenges }, 120);
    return { title: rendered[0]!, lines: rendered.slice(1) };
  }
  if (key === "encore-council:list") {
    const goalId = selectedGoal(command, context);
    if (typeof goalId !== "string") return goalId;
    const rounds = await context.client.listEncoreCouncilRounds(goalId, { projectId: context.projectId });
    const rendered = renderEncorePanel({ kind: "value", value: rounds.rounds }, 120);
    return { title: rendered[0]!, lines: rendered.slice(1) };
  }
  if (key === "certification:list" || key === "certifications:list") {
    const goalId = selectedGoal(command, context);
    if (typeof goalId !== "string") return goalId;
    const certifications = await context.client.listCertifications(goalId, { projectId: context.projectId });
    const rendered = renderCertificationPanel({ kind: "value", value: certifications.certifications }, 120);
    return { title: rendered[0]!, lines: rendered.slice(1) };
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
