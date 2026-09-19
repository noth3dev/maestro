import { basename } from "node:path";
import type { Workspace } from "../workspace.js";
import type { SidebarSection } from "./sidebar.js";
import { LOCAL_BOOTSTRAP_STEP_ORDER, type LocalBootstrapStepEvent, type LocalBootstrapStepName } from "@maestro/local-backend";
import type { OrganizationReadModel } from "../panels/organization-panel.js";
import { getZeroArgumentNoGoalActions } from "../commands/registry.js";
import type { ConversationActivityEvent } from "@maestro/contracts";
import { fitPlain, tuiTheme } from "../theme.js";

export type AsyncState<T> = { kind: "loading" } | { kind: "empty" } | { kind: "error"; message: string } | { kind: "value"; value: T };

export interface PendingDecision {
  /** Command/effect identity that can be correlated with durable activity. */
  readonly identity: string;
  readonly tier: string;
  readonly action: string;
  readonly actor: string;
}

export type SetupStep = LocalBootstrapStepEvent;

export interface TuiShellState {
  workspace: Workspace;
  model?: string;
  setupSteps?: readonly SetupStep[];
  mode?: "maestro" | "flashmob";
  working?: boolean;
  workingSince?: number;
  workingTick?: number;
  conversationActivity?: Pick<ConversationActivityEvent, "phase" | "toolName" | "status">;
  connection:
    { kind: "connected" } | { kind: "connecting" } | { kind: "setup-required"; message: string } | { kind: "error"; message: string };
  goal: AsyncState<{ goalId: string; name: string; state: string }>;
  workers: AsyncState<number>;
  approvals: AsyncState<number>;
  budget: AsyncState<{ spentCents: number; ceilingCents: number }>;
  organization?: AsyncState<OrganizationReadModel>;
  project?: { kind: "attached" } | { kind: "unavailable"; guidance?: string };
  pendingDecisions?: readonly PendingDecision[];
}

export interface TuiLayoutFrame {
  readonly splash: string[];
  readonly status: string[];
  readonly stream: string[];
  readonly decisions: string[];
  readonly input: string[];
  readonly hints: string[];
}

export interface TuiLayoutOptions {
  readonly showSplash?: boolean;
  readonly stream?: readonly string[];
  readonly input?: readonly string[];
}

function stateText<T>(state: AsyncState<T>, format: (value: T) => string): string {
  if (state.kind === "loading") return "loading";
  if (state.kind === "empty") return "none";
  if (state.kind === "error") return `error: ${state.message}`;
  return format(state.value);
}

function goalText(state: Pick<TuiShellState, "goal">): string {
  return stateText(state.goal, (value) => `${value.name} · ${value.state}`);
}

function goalStateText(state: TuiShellState): string {
  return stateText(state.goal, (value) => value.state);
}

function workerText(state: Pick<TuiShellState, "workers">): string {
  return stateText(state.workers, (value) => `${value} worker${value === 1 ? "" : "s"}`);
}

export function isBlockedSetupState(
  state: Pick<TuiShellState, "connection" | "setupSteps">,
  recoveryKind: "new" | "unavailable" | "attached" | "stale",
  hasTranscript: boolean,
  hasActivity: boolean,
): boolean {
  return (
    state.connection.kind === "setup-required" &&
    recoveryKind === "new" &&
    (state.setupSteps === undefined || state.setupSteps.length === 0) &&
    !hasTranscript &&
    !hasActivity
  );
}

export function pendingCount(state: TuiShellState): number {
  if (state.pendingDecisions !== undefined) return state.pendingDecisions.length;
  return state.approvals.kind === "value" ? state.approvals.value : 0;
}

/**
 * Nav-row badges derived from live state, recomputed every render.
 * Billing shows a rounded spend percent only when a positive ceiling is
 * known; loading, empty, error, and zero-ceiling states show no badge,
 * never a bare zero.
 */
export function sidebarNavBadges(state: TuiShellState): Record<string, string> {
  const badges: Record<string, string> = {};
  const pending = pendingCount(state);
  if (pending > 0) badges.inbox = `(${pending})`;
  if (state.budget.kind === "value" && state.budget.value.ceilingCents > 0) {
    badges.billing = `(${Math.round((state.budget.value.spentCents / state.budget.value.ceilingCents) * 100)}%)`;
  }
  return badges;
}

function budgetText(state: Pick<TuiShellState, "budget">): string {
  if (state.budget.kind !== "value") return stateText(state.budget, String);
  const spent = (state.budget.value.spentCents / 100).toFixed(2);
  const ceiling = (state.budget.value.ceilingCents / 100).toFixed(2);
  return `$${spent}/$${ceiling}`;
}

function connectionMessage(state: Pick<TuiShellState, "connection">): string | undefined {
  if (state.connection.kind === "connected") return undefined;
  if (state.connection.kind === "connecting") return "gateway connecting";
  return state.connection.message;
}

export function setupRequiredGuidance(width: number, compact = false): string {
  const guidance = compact ? "Set URL+token or local start; restart" : "Set MAESTRO_API_URL + MAESTRO_API_TOKEN; restart";
  return fitPlain(guidance, width);
}

function setupRequiredAutostartHint(width: number, compact = false): string {
  return fitPlain(compact ? "or enable local autostart; restart" : "Or enable local autostart; restart", width);
}

function pendingPaint(text: string): string {
  return tuiTheme.warning(text);
}

/** One-line status, ordered by what can change the operator's next action. */
export function renderStatusRow(state: TuiShellState, width: number): string {
  if (state.connection.kind === "setup-required") {
    return tuiTheme.warning(fitPlain(`⚠ ${setupRequiredGuidance(width)}`, width));
  }
  const connection = connectionMessage(state);
  if (connection !== undefined) return tuiTheme.warning(fitPlain(`⚠ ${connection} · retry with ctrl+r`, width));

  const count = pendingCount(state);
  const pending = count > 0 ? ` · ⏸ ${count} need you` : "";
  let base: string;
  if (width >= 100)
    base = `${state.mode === "flashmob" ? "flashmob" : "maestro"} · ${goalText(state)} · ${workerText(state)} · ${budgetText(state)}`;
  else if (width >= 80) base = `${state.mode === "flashmob" ? "flashmob" : "maestro"} · ${goalText(state)} · ${workerText(state)}`;
  else if (width >= 60) base = `${state.mode === "flashmob" ? "flashmob" : "maestro"} · ${goalStateText(state)}`;
  else base = goalStateText(state);
  if (pending === "") return tuiTheme.text(fitPlain(base, width));
  const baseWidth = Math.max(0, width - pending.length);
  const left = fitPlain(base, baseWidth).padEnd(baseWidth, " ");
  return `${tuiTheme.text(left)}${pendingPaint(fitPlain(pending, width - baseWidth))}`;
}

export interface SidebarStatus {
  workspace: Workspace;
  model?: string | undefined;
  connection: TuiShellState["connection"];
  goal: TuiShellState["goal"];
  workers: TuiShellState["workers"];
  budget: TuiShellState["budget"];
}

export function toSidebarStatus(state: TuiShellState): SidebarStatus {
  return {
    workspace: state.workspace,
    model: state.model,
    connection: state.connection,
    goal: state.goal,
    workers: state.workers,
    budget: state.budget,
  };
}

/** Labeled session rows for the sidebar; keyboard/mouse nav groups arrive later. */
export function renderStatusSection(status: SidebarStatus, width: number): SidebarSection[] {
  void width;
  const connection = status.connection.kind === "connected" ? "connected" : connectionMessage(status);
  const dir = basename(status.workspace.gitRoot ?? status.workspace.cwd);
  return [
    {
      title: "status",
      rows: [
        { label: "model", value: status.model ?? "none" },
        { label: "goal", value: goalText(status) },
        { label: "workers", value: workerText(status) },
        { label: "budget", value: budgetText(status) },
        { label: "conn", value: connection ?? "connected" },
        { label: "dir", value: dir === "" ? "/" : dir },
      ],
    },
  ];
}

function pendingDecisionRows(state: TuiShellState): PendingDecision[] {
  return (state.pendingDecisions ?? []).filter((decision) => typeof decision.identity === "string" && decision.identity.trim() !== "");
}

function decisionRows(state: TuiShellState, width: number, height: number): string[] {
  const decisions = pendingDecisionRows(state);
  if (decisions.length === 0) return [];
  if (width < 60) return [fitPlain(`⏸ ${decisions.length} pending decisions · ctrl+a to review`, width)];
  const maxVisible = height < 24 ? 1 : 2;
  const visible = decisions.slice(0, maxVisible).map((decision) => {
    const actor = width >= 100 ? `  ${decision.actor}` : "";
    return fitPlain(`⏸ ${decision.tier}  ${decision.action}${actor}`, width);
  });
  if (decisions.length > visible.length) visible.push(fitPlain(`  +${decisions.length - visible.length} more · ctrl+a to review`, width));
  return visible;
}

export function renderDecisionRegion(state: TuiShellState, width: number, height = 24): string[] {
  if (height < 16) return [];
  const rows = decisionRows(state, width, height);
  if (rows.length === 0) return [];
  if (width < 60 || height < 24) return rows.map((row) => tuiTheme.warning(row));
  return [
    tuiTheme.border("─".repeat(Math.max(0, width))),
    ...rows.map((row) => tuiTheme.warning(row)),
    tuiTheme.border("─".repeat(Math.max(0, width))),
  ];
}

/** Details shown by the one-keystroke review action when a decision was replayed from storage. */
export function renderPendingDecisionDetails(state: TuiShellState, width: number): string[] {
  return (state.pendingDecisions ?? [])
    .filter((decision) => typeof decision.identity === "string" && decision.identity.trim() !== "")
    .map((decision) => fitPlain(`⏸ ${decision.tier} · ${decision.action} · requested by ${decision.actor}`, width));
}

function noProjectRecoveryAcknowledgement(width: number): string {
  const full = "No projects available · ask admin to provision access · ctrl+r retry";
  if (width >= full.length) return full;
  return fitPlain("No project · admin provision · ctrl+r", width);
}

function projectActionText(state: TuiShellState, width = 80): string {
  if (state.connection.kind !== "connected" || state.project?.kind !== "unavailable") return "";
  if (state.project.guidance === "No projects are available for this operator") return noProjectRecoveryAcknowledgement(width);
  if (state.project.guidance?.startsWith("Project discovery unavailable:"))
    return fitPlain("Project discovery failed · ctrl+r retry", width);
  const match = state.project.guidance?.match(/\/session attach(?:\s+--project-index=\d+)?/);
  const command = match?.[0] ?? "/session attach";
  return command;
}

function nextActionText(state: TuiShellState, width = 80): string {
  if (state.connection.kind === "connected" && state.project?.kind === "unavailable") return projectActionText(state, width);
  return getZeroArgumentNoGoalActions()
    .slice(0, 3)
    .map((action) => `/${action.command} ${action.action}`)
    .join(" · ");
}

function hasPendingDecisionRows(state: TuiShellState): boolean {
  return pendingDecisionRows(state).length > 0;
}

const WORKING_SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

function workingElapsed(since: number | undefined): string | undefined {
  if (since === undefined) return undefined;
  const seconds = Math.max(0, Math.floor((Date.now() - since) / 1_000));
  return `${seconds}s`;
}

function workingLabel(state: TuiShellState): string {
  const activity = state.conversationActivity;
  if (activity === undefined) {
    const work = state.goal.kind === "value" ? `working on ${state.goal.value.name}` : "Concertmaster in progress";
    const workers = state.workers.kind === "value" ? ` · ${workerText(state)}` : "";
    return `${work}${workers}`;
  }
  const label =
    activity.phase === "thinking"
      ? "Thinking"
      : activity.phase === "writing"
        ? "Writing"
        : activity.phase === "tool-call"
          ? "Preparing tool"
          : activity.phase === "executing"
            ? "Executing"
            : activity.phase === "tool-result"
              ? "Checking result"
              : activity.phase === "error"
                ? "Recovering"
                : "Working";
  return activity.toolName === undefined ? label : `${label} ${activity.toolName}`;
}

export function renderInputPlaceholder(state: TuiShellState, width: number, compact = false): string {
  if (state.connection.kind === "setup-required") return setupRequiredGuidance(width, compact);
  if (state.connection.kind === "connected" && state.project?.kind === "unavailable") return projectActionText(state, width);
  const decisions = pendingDecisionRows(state);
  if (decisions.length > 0) {
    const tier = decisions[0]?.tier ?? "authority";
    const count = decisions.length;
    if (compact) return fitPlain(`ctrl+a review · ⏸ ${count} pending decision${count === 1 ? "" : "s"}`, width);
    return fitPlain(`⏸ ${tier} · ${count} pending decision${count === 1 ? "" : "s"} · operator response required`, width);
  }
  if (state.working === true) {
    const phase = state.conversationActivity?.phase;
    const activityStatus = state.conversationActivity?.status;
    const indicator =
      phase === "error" || activityStatus === "error" || activityStatus === "unknown"
        ? "✗"
        : phase === "tool-result" && activityStatus === "ok"
          ? "✓"
          : WORKING_SPINNER[(state.workingTick ?? 0) % WORKING_SPINNER.length];
    const elapsed = workingElapsed(state.workingSince);
    const parts = [indicator, workingLabel(state), ...(elapsed === undefined ? [] : [elapsed])];
    return fitPlain(`${parts.join(" ")} · esc stop`, width);
  }
  return fitPlain("message to Concertmaster · Enter to send", width);
}

export function renderSplash(state: TuiShellState, width: number): string[] {
  if (hasPendingDecisionRows(state)) return [];
  if (state.goal.kind === "value") {
    return [
      tuiTheme.primary(fitPlain(`✦ ${state.goal.value.name}`, width)),
      tuiTheme.secondary(fitPlain(`Performing · ${state.goal.value.state} · ${workerText(state)}`, width)),
      tuiTheme.dim(
        fitPlain(
          state.connection.kind === "connected" && state.project?.kind === "unavailable"
            ? nextActionText(state, width)
            : `ctrl+/ show home · Next: ${nextActionText(state, width)}`,
          width,
        ),
      ),
    ];
  }
  const organization = state.organization;
  const departmentHeads =
    organization?.kind === "value"
      ? `${organization.value.departments.length} Department Head${organization.value.departments.length === 1 ? "" : "s"}`
      : "Department Heads unavailable";
  return [
    tuiTheme.primary(fitPlain("✦ MAESTRO", width)),
    tuiTheme.secondary(fitPlain(`Concertmaster ready · ${departmentHeads}`, width)),
    tuiTheme.dim(
      fitPlain(
        state.connection.kind === "connected" && state.project?.kind === "unavailable"
          ? nextActionText(state, width)
          : `ctrl+/ show home · Next: ${nextActionText(state, width)}`,
        width,
      ),
    ),
  ];
}

const setupStepLabels: Record<LocalBootstrapStepName, string> = {
  "docker-check": "Docker check",
  "postgres-ready": "PostgreSQL ready",
  migrations: "Migrations",
  "control-plane-up": "Control Plane",
  "model-gateway-up": "Model gateway",
};

function setupStepGlyph(status: SetupStep["status"]): string {
  if (status === "completed") return "✓";
  if (status === "started") return "›";
  if (status === "failed") return "×";
  return "·";
}

export function renderSetupSteps(state: TuiShellState, width: number): string[] {
  if (state.connection.kind === "connected" || state.setupSteps === undefined || state.setupSteps.length === 0) return [];
  const latest = new Map<LocalBootstrapStepName, SetupStep>();
  for (const step of state.setupSteps ?? []) latest.set(step.step, step);
  const embedded = latest.get("postgres-ready")?.message?.toLowerCase().includes("embedded") === true;
  const visibleSteps = embedded ? LOCAL_BOOTSTRAP_STEP_ORDER.filter((stepName) => stepName !== "docker-check") : LOCAL_BOOTSTRAP_STEP_ORDER;
  return visibleSteps.map((stepName) => {
    const step = latest.get(stepName) ?? { step: stepName, status: "pending" as const };
    const message = step.status === "failed" && step.message !== undefined ? ` · ${step.message}` : "";
    return tuiTheme.text(fitPlain(`${setupStepGlyph(step.status)} ${setupStepLabels[step.step]}${message}`, width));
  });
}

export interface SplashController {
  visible(): boolean;
  dismiss(): void;
  restore(): void;
  consume(): void;
}

export function createSplashController(): SplashController {
  let isVisible = true;
  let restored = false;
  return {
    visible: () => isVisible,
    dismiss: () => {
      isVisible = false;
      restored = false;
    },
    restore: () => {
      isVisible = true;
      restored = true;
    },
    consume: () => {
      if (restored) restored = false;
      else isVisible = false;
    },
  };
}

function hintText(state: TuiShellState, width = 80): string {
  if (state.connection.kind === "setup-required") return setupRequiredAutostartHint(width, width < 60);
  if (connectionMessage(state) !== undefined) return "ctrl+r retry · /help for commands";
  if (state.working === true) return `esc stop · ctrl+a decisions${pendingCount(state) > 0 ? ` (${pendingCount(state)})` : ""}`;
  const count = pendingCount(state);
  if (count > 0) return `ctrl+a review ${count} pending decision${count === 1 ? "" : "s"}`;
  if (state.workers.kind === "loading") return "esc stop · ctrl+a decisions";
  if (state.connection.kind === "connected" && state.project?.kind === "unavailable") return projectActionText(state, width);
  return "/ commands · ctrl+g goals · /help";
}

export function renderHints(state: TuiShellState, width: number, options: { sidebarHint?: boolean } = {}): string {
  const hint = options.sidebarHint ? `${hintText(state, width)} · ctrl+b sidebar` : hintText(state, width);
  return tuiTheme.dim(fitPlain(hint, width));
}

export function renderTuiLayout(state: TuiShellState, width: number, height: number, options: TuiLayoutOptions = {}): TuiLayoutFrame {
  const splash = options.showSplash === true && width >= 40 && height >= 16 ? renderSplash(state, width) : [];
  const status = [renderStatusRow(state, width)];
  const decisions = renderDecisionRegion(state, width, height);
  const input = [fitPlain(options.input?.[0] ?? renderInputPlaceholder(state, width, height < 16), width)];
  const hints = [renderHints(state, width)];
  if (height < 16) return { splash, status, stream: [], decisions: [], input, hints: [] };
  const streamHeight = Math.max(0, height - status.length - decisions.length - input.length - hints.length - splash.length);
  const source = options.stream ?? [];
  const stream = [...source.slice(-streamHeight)];
  while (stream.length < streamHeight) stream.push("");
  return { splash, status, stream, decisions, input, hints };
}

/** Fixed status chrome rendered above the independently scrollable conversation viewport. */
export function renderStatusRegion(state: TuiShellState, width: number, height = 30, options: TuiLayoutOptions = {}): string[] {
  const frame = renderTuiLayout(state, width, height, options);
  return [...frame.splash, ...renderSetupSteps(state, width), ...frame.status];
}

/** Compatibility wrapper for callers that still need the complete fixed chrome. */
export function renderShell(state: TuiShellState, width: number, height = 30, options: TuiLayoutOptions = {}): string[] {
  const frame = renderTuiLayout(state, width, height, options);
  return [...frame.splash, ...frame.status, ...frame.decisions];
}

/** Compatibility wrapper: the header is now a single status row. */
export function renderStatusHeader(state: TuiShellState, width: number, _height = 30): string[] {
  return [renderStatusRow(state, width)];
}

export function renderTuiFooter(width: number, state?: TuiShellState, options: { sidebarHint?: boolean } = {}): string {
  return renderHints(
    state ?? {
      workspace: { cwd: "", gitRoot: "" },
      connection: { kind: "connected" },
      goal: { kind: "empty" },
      workers: { kind: "empty" },
      approvals: { kind: "empty" },
      budget: { kind: "empty" },
    },
    width,
    options,
  );
}
