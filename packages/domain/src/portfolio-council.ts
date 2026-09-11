import {
  MODEL_CAPABILITY_AXES,
  assertValidModelCapabilityVector,
  type ModelCapabilityVector,
} from "./model-profile.js";
import { assertValidTaskDemand, type TaskDemand } from "./task-demand.js";
import { assertValidPressure, classifyPressureBand, type PressureBandProjection } from "./pressure-band.js";
import { requiresImmediateSafePause } from "./discord-incident.js";
import type { DiscordSeverity } from "./discord.js";

export type PortfolioCouncilTrigger = "capacity_conflict" | "incident_preemption" | "reconsideration";
export type PortfolioGoalDisposition = "continue" | "queue" | "pause" | "preempt";
export type PortfolioDecisionPrecedence = "portfolio_council" | "discord_safety_preemption";

export interface PortfolioAllocation {
  readonly providerRate: number;
  readonly spendCents: number;
  readonly workerSlots: number;
}

export interface PortfolioExecutionFence {
  readonly previousExecutionRef: string;
  readonly previousFencingToken: string;
  readonly nextFencingToken: string;
}

export interface PortfolioRouting {
  readonly modelRef: string;
  readonly capability: ModelCapabilityVector;
}

export interface PortfolioGoalInput {
  readonly goalId: string;
  readonly projectId: string;
  readonly priority: number;
  readonly ceoPinned: boolean;
  readonly pressure: number;
  readonly taskDemand: TaskDemand;
  readonly currentRouting: PortfolioRouting;
  readonly approvedCeiling: PortfolioAllocation;
  readonly currentAllocation: PortfolioAllocation;
  readonly safePausePoint?: string;
}

export interface PortfolioActionInput {
  readonly goalId: string;
  readonly disposition: PortfolioGoalDisposition;
  readonly order: number;
  readonly allocation: PortfolioAllocation;
  readonly rationale: string;
  readonly executionFence?: PortfolioExecutionFence;
}

export interface DiscordSafetyPreemption {
  readonly incidentId: string;
  readonly goalId: string;
  readonly severity: DiscordSeverity;
  readonly confidence: number;
  readonly reason: string;
}

export interface PortfolioCouncilInput {
  readonly councilId: string;
  readonly commandId: string;
  readonly trigger: PortfolioCouncilTrigger;
  readonly goals: readonly PortfolioGoalInput[];
  readonly actions: readonly PortfolioActionInput[];
  readonly evidenceReferences: readonly string[];
  readonly dissent: readonly string[];
  readonly confidence: number;
  readonly reconsiderationTriggers: readonly string[];
  readonly discordPreemption?: DiscordSafetyPreemption;
}

export interface PortfolioRoutingEscalation {
  readonly goalId: string;
  readonly modelRef: string;
  readonly band: PressureBandProjection["band"];
  readonly decisionLayer: PressureBandProjection["decisionLayer"];
  readonly reason: string;
}

export interface PortfolioAction extends PortfolioActionInput {}

export interface PortfolioCouncilDecision {
  readonly schemaVersion: 1;
  readonly councilId: string;
  readonly commandId: string;
  readonly trigger: PortfolioCouncilTrigger;
  readonly status: "decided" | "escalated";
  readonly executionDisposition: "executable" | "non_executable";
  readonly precedence: PortfolioDecisionPrecedence;
  /** Immutable Goal/project bindings captured by this Council round. */
  readonly goals: readonly PortfolioGoalInput[];
  readonly pressure: PressureBandProjection;
  readonly actions: readonly PortfolioAction[];
  readonly routingEscalations: readonly PortfolioRoutingEscalation[];
  readonly evidenceReferences: readonly string[];
  readonly dissent: readonly string[];
  readonly confidence: number;
  readonly reconsiderationTriggers: readonly string[];
  readonly discordPreemption: DiscordSafetyPreemption | null;
}

export class PortfolioCouncilValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortfolioCouncilValidationError";
  }
}

function line(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "" || /[\r\n]/.test(value)) {
    throw new PortfolioCouncilValidationError(`${field} must be a non-empty single line`);
  }
}

function list(value: unknown, field: string, allowEmpty = false): asserts value is readonly string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || !value.every((item) => typeof item === "string" && item.trim() !== "" && !/[\r\n]/.test(item))) {
    throw new PortfolioCouncilValidationError(`${field} must contain ${allowEmpty ? "only " : "at least one "}non-empty single-line values`);
  }
}

function nonnegativeInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new PortfolioCouncilValidationError(`${field} must be a non-negative safe integer`);
  }
}

function probability(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new PortfolioCouncilValidationError(`${field} must be between 0 and 1`);
  }
}

function allocation(value: PortfolioAllocation, field: string): void {
  for (const key of ["providerRate", "spendCents", "workerSlots"] as const) nonnegativeInteger(value[key], `${field}.${key}`);
}

function sameAllocation(left: PortfolioAllocation, right: PortfolioAllocation): boolean {
  return left.providerRate === right.providerRate && left.spendCents === right.spendCents && left.workerSlots === right.workerSlots;
}

function routingMeetsDemand(routing: PortfolioRouting, taskDemand: TaskDemand): boolean {
  return MODEL_CAPABILITY_AXES.every((axis) => {
    const required = taskDemand.requirements[axis].level;
    const score = routing.capability.axes[axis];
    return required === 0 || (score.status === "scored" && score.score !== null && score.score >= required);
  });
}

function validateInput(input: PortfolioCouncilInput): void {
  line(input.councilId, "councilId");
  line(input.commandId, "commandId");
  if (input.trigger !== "capacity_conflict" && input.trigger !== "incident_preemption" && input.trigger !== "reconsideration") {
    throw new PortfolioCouncilValidationError("trigger is invalid");
  }
  if (!Array.isArray(input.goals) || input.goals.length === 0) throw new PortfolioCouncilValidationError("goals must be non-empty");
  if (!Array.isArray(input.actions) || input.actions.length === 0) throw new PortfolioCouncilValidationError("actions must be non-empty");
  const goalIds = new Set<string>();
  for (const goal of input.goals) {
    line(goal.goalId, "goal.goalId");
    line(goal.projectId, "goal.projectId");
    if (goalIds.has(goal.goalId)) throw new PortfolioCouncilValidationError(`duplicate Goal ${goal.goalId}`);
    goalIds.add(goal.goalId);
    nonnegativeInteger(goal.priority, `goal ${goal.goalId} priority`);
    if (typeof goal.ceoPinned !== "boolean") throw new PortfolioCouncilValidationError(`goal ${goal.goalId} ceoPinned must be boolean`);
    assertValidPressure(goal.pressure);
    assertValidTaskDemand(goal.taskDemand);
    line(goal.currentRouting.modelRef, `goal ${goal.goalId} modelRef`);
    assertValidModelCapabilityVector(goal.currentRouting.capability);
    allocation(goal.approvedCeiling, `goal ${goal.goalId} approvedCeiling`);
    allocation(goal.currentAllocation, `goal ${goal.goalId} currentAllocation`);
    for (const key of ["providerRate", "spendCents", "workerSlots"] as const) {
      if (goal.currentAllocation[key] > goal.approvedCeiling[key]) throw new PortfolioCouncilValidationError(`goal ${goal.goalId} current allocation exceeds approved ceiling`);
    }
    if (goal.safePausePoint !== undefined) line(goal.safePausePoint, `goal ${goal.goalId} safePausePoint`);
  }
  const actionIds = new Set<string>();
  for (const action of input.actions) {
    line(action.goalId, "action.goalId");
    if (!goalIds.has(action.goalId)) throw new PortfolioCouncilValidationError(`action names unknown Goal ${action.goalId}`);
    if (actionIds.has(action.goalId)) throw new PortfolioCouncilValidationError(`duplicate action for Goal ${action.goalId}`);
    actionIds.add(action.goalId);
    if (!["continue", "queue", "pause", "preempt"].includes(action.disposition)) throw new PortfolioCouncilValidationError("action disposition is invalid");
    nonnegativeInteger(action.order, `action ${action.goalId} order`);
    allocation(action.allocation, `action ${action.goalId} allocation`);
    line(action.rationale, `action ${action.goalId} rationale`);
    const goal = input.goals.find((candidate) => candidate.goalId === action.goalId)!;
    for (const key of ["providerRate", "spendCents", "workerSlots"] as const) {
      if (action.allocation[key] > goal.approvedCeiling[key]) throw new PortfolioCouncilValidationError(`action ${action.goalId} exceeds approved ceiling`);
    }
    if ((action.disposition === "pause" || action.disposition === "preempt") && action.executionFence === undefined) {
      throw new PortfolioCouncilValidationError(`action ${action.goalId} requires an execution fence`);
    }
    if (action.executionFence !== undefined) {
      line(action.executionFence.previousExecutionRef, `action ${action.goalId} previousExecutionRef`);
      line(action.executionFence.previousFencingToken, `action ${action.goalId} previousFencingToken`);
      line(action.executionFence.nextFencingToken, `action ${action.goalId} nextFencingToken`);
    }
  }
  list(input.evidenceReferences, "evidenceReferences");
  list(input.dissent, "dissent", true);
  list(input.reconsiderationTriggers, "reconsiderationTriggers");
  probability(input.confidence, "confidence");
  if (input.discordPreemption !== undefined) {
    line(input.discordPreemption.incidentId, "discordPreemption.incidentId");
    line(input.discordPreemption.goalId, "discordPreemption.goalId");
    if (!goalIds.has(input.discordPreemption.goalId)) throw new PortfolioCouncilValidationError("Discord preemption names an unknown Goal");
    if (input.discordPreemption.severity !== "info" && input.discordPreemption.severity !== "warning" && input.discordPreemption.severity !== "critical") throw new PortfolioCouncilValidationError("Discord preemption severity is invalid");
    probability(input.discordPreemption.confidence, "discordPreemption.confidence");
    line(input.discordPreemption.reason, "discordPreemption.reason");
  }
}

/**
 * Resolve the portfolio scheduling decision without changing any Goal's
 * declared TaskDemand. Capacity can change order or disposition, but it can
 * never turn a failing A↔D routing check into an executable assignment.
 */
export function decidePortfolioCouncil(input: PortfolioCouncilInput): PortfolioCouncilDecision {
  validateInput(input);
  const pressure = classifyPressureBand(Math.max(...input.goals.map((goal) => goal.pressure)));
  const routingEscalations = input.goals.flatMap((goal) => routingMeetsDemand(goal.currentRouting, goal.taskDemand) ? [] : [{
    goalId: goal.goalId,
    modelRef: goal.currentRouting.modelRef,
    band: classifyPressureBand(goal.pressure).band,
    decisionLayer: classifyPressureBand(goal.pressure).decisionLayer,
    reason: "The current routing candidate is below the Goal's immutable A↔D requirement",
  }]);
  if (routingEscalations.length > 0) {
    return {
      schemaVersion: 1,
      councilId: input.councilId,
      commandId: input.commandId,
      trigger: input.trigger,
      status: "escalated",
      executionDisposition: "non_executable",
      precedence: "portfolio_council",
      goals: input.goals.map((goal) => ({ ...goal })),
      pressure,
      actions: [],
      routingEscalations,
      evidenceReferences: [...input.evidenceReferences],
      dissent: [...input.dissent],
      confidence: input.confidence,
      reconsiderationTriggers: [...input.reconsiderationTriggers],
      discordPreemption: input.discordPreemption ?? null,
    };
  }
  const goals = new Map(input.goals.map((goal) => [goal.goalId, goal]));
  const safety = input.discordPreemption !== undefined && requiresImmediateSafePause(input.discordPreemption.severity, input.discordPreemption.confidence);
  const actions = input.actions.map((action) => {
    const goal = goals.get(action.goalId)!;
    if (!safety && goal.ceoPinned && (action.disposition === "queue" || action.disposition === "pause")) {
      throw new PortfolioCouncilValidationError(`CEO-pinned Goal ${goal.goalId} cannot be paused or deprioritized by the Council`);
    }
    if (safety && input.discordPreemption!.goalId === action.goalId) {
      if (action.executionFence === undefined) throw new PortfolioCouncilValidationError(`Discord safety preemption for ${action.goalId} requires an execution fence`);
      return { ...action, disposition: "preempt" as const, allocation: { providerRate: 0, spendCents: 0, workerSlots: 0 }, rationale: input.discordPreemption!.reason };
    }
    if (action.disposition === "pause" && goal.safePausePoint === undefined) throw new PortfolioCouncilValidationError(`Goal ${goal.goalId} has no declared safe pause point`);
    return { ...action };
  }).sort((left, right) => left.order - right.order || left.goalId.localeCompare(right.goalId));
  return {
    schemaVersion: 1,
    councilId: input.councilId,
    commandId: input.commandId,
    trigger: input.trigger,
    status: "decided",
    executionDisposition: "executable",
    precedence: safety ? "discord_safety_preemption" : "portfolio_council",
    goals: input.goals.map((goal) => ({ ...goal })),
    pressure,
    actions,
    routingEscalations: [],
    evidenceReferences: [...input.evidenceReferences],
    dissent: [...input.dissent],
    confidence: input.confidence,
    reconsiderationTriggers: [...input.reconsiderationTriggers],
    discordPreemption: input.discordPreemption ?? null,
  };
}
