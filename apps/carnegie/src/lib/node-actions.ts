import type { ApiClient } from "@maestro/api-client";
import type { ActionClassification, CriticalActionInput, CriticalActionResult, FullAccessMode, GoalControlInput, GoalResult, ProjectionNode } from "@maestro/contracts";

export type NodeControlCommand = "pauseGoal" | "resumeGoal" | "stopGoal" | "emergencyStopGoal";
export type NodeActionCommand = NodeControlCommand | "requestCriticalAction" | "approveAndRunCriticalAction" | "selectFullAccessMode";

export type NodeActionsApi = Pick<ApiClient, NodeActionCommand>;

export interface NodeActionActor {
  readonly kind: "user" | "department_head" | "encore_council" | "system";
  readonly authorized: boolean;
  readonly reason?: string;
  readonly decisionPath?: string;
}

/** These fields are deliberately the complete critical confirmation disclosure. */
export interface CriticalConfirmation {
  readonly action: string;
  readonly target: string;
  readonly goalId: string;
  readonly expiresAt: string;
  readonly expectedEffect: string;
  readonly rollbackFeasibility: string;
  readonly classification?: ActionClassification;
  readonly decision?: "pending" | "approved" | "declined";
}

export interface NodeActionContext {
  readonly actor: NodeActionActor;
  readonly critical?: CriticalConfirmation;
  readonly criticalInput?: Pick<CriticalActionInput, "policyVersion" | "budgetEffectCents">;
  readonly criticalCommand?: "requestCriticalAction" | "approveAndRunCriticalAction";
  readonly controls?: readonly NodeControlCommand[];
}

export interface NodeActionBase {
  readonly nodeId: string;
  readonly label: string;
  readonly command: NodeActionCommand;
}
export interface NodeCommandAction extends NodeActionBase {
  readonly kind: "command";
  readonly enabled: boolean;
}
export interface NodeCriticalAction extends NodeActionBase {
  readonly kind: "critical";
  readonly enabled: true;
  readonly confirmation: CriticalConfirmation;
}
export interface NodeUnauthorizedAction extends NodeActionBase {
  readonly kind: "unauthorized";
  readonly enabled: false;
  readonly reason: string;
  readonly decisionPath: string;
}
export type NodeAction = NodeCommandAction | NodeCriticalAction | NodeUnauthorizedAction;

const CONTROL_LABELS: Readonly<Record<NodeControlCommand, string>> = {
  pauseGoal: "Pause Goal",
  resumeGoal: "Resume Goal",
  stopGoal: "Stop Goal",
  emergencyStopGoal: "Emergency stop Goal",
};
const DEFAULT_CONTROLS: readonly NodeControlCommand[] = ["pauseGoal", "resumeGoal", "stopGoal", "emergencyStopGoal"];

function actionForControl(node: ProjectionNode, command: NodeControlCommand, actor: NodeActionActor): NodeAction {
  const common = { nodeId: node.nodeId, label: CONTROL_LABELS[command], command } as const;
  if (!actor.authorized) return { ...common, kind: "unauthorized", enabled: false, reason: actor.reason ?? "This actor is not authorized for this control.", decisionPath: actor.decisionPath ?? "Request the required Goal decision." };
  return { ...common, kind: "command", enabled: true };
}

/**
 * Build controls from the projection node without adding a client-side authority rule.
 * The server remains authoritative; unauthorized controls stay visible with their path.
 */
export function buildNodeActions(node: ProjectionNode, context: NodeActionContext): readonly NodeAction[] {
  const controls = context.controls ?? (node.kind === "goal" ? DEFAULT_CONTROLS : []);
  const actions: NodeAction[] = controls.map((command) => actionForControl(node, command, context.actor));
  const critical = context.critical;
  if (critical !== undefined && critical.goalId === node.goalId && critical.classification !== "forbidden" && critical.decision !== "declined") {
    const criticalCommand = context.criticalCommand ?? "approveAndRunCriticalAction";
    const base = { nodeId: node.nodeId, label: `${criticalCommand === "requestCriticalAction" ? "Review" : "Approve"} ${critical.action}`, command: criticalCommand, confirmation: critical };
    if (!context.actor.authorized) actions.push({ ...base, kind: "unauthorized", enabled: false, reason: context.actor.reason ?? "This actor is not authorized for this critical action.", decisionPath: context.actor.decisionPath ?? "Request the required approval." });
    else actions.push({ ...base, kind: "critical", enabled: true as const });
  }
  return actions;
}

export type RunNodeActionInput =
  | { readonly kind: "command"; readonly command: NodeControlCommand; readonly node: ProjectionNode }
  | { readonly kind: "critical"; readonly command: "requestCriticalAction" | "approveAndRunCriticalAction"; readonly node: ProjectionNode; readonly critical: CriticalConfirmation; readonly input?: Pick<CriticalActionInput, "policyVersion" | "budgetEffectCents" | "projectId"> }
  | { readonly kind: "full-access"; readonly node: ProjectionNode; readonly mode: FullAccessMode; readonly sessionId: string };

/** Execute exactly one exposed server command. No action can be composed into another command. */
export function runNodeAction(api: NodeActionsApi, action: RunNodeActionInput, commandId: string): Promise<GoalResult | CriticalActionResult | Awaited<ReturnType<ApiClient["selectFullAccessMode"]>>> {
  if (action.node.removed) throw new Error("Cannot act on a removed projection node");
  if (action.kind === "command") {
    const input: GoalControlInput = { projectId: action.node.projectId, expectedVersion: action.node.version ?? 0 };
    switch (action.command) {
      case "pauseGoal": return api.pauseGoal(action.node.goalId, input, commandId);
      case "resumeGoal": return api.resumeGoal(action.node.goalId, input, commandId);
      case "stopGoal": return api.stopGoal(action.node.goalId, input, commandId);
      case "emergencyStopGoal": return api.emergencyStopGoal(action.node.goalId, input, commandId);
    }
  }
  if (action.kind === "full-access") {
    return api.selectFullAccessMode(action.node.goalId, { projectId: action.node.projectId, capabilityKind: "ipython", sessionId: action.sessionId, fullAccessMode: action.mode });
  }
  if (action.critical.classification === "forbidden") throw new Error("forbidden actions cannot be approved or executed");
  if (action.critical.decision === "declined") throw new Error("declined critical actions cannot be silently downgraded");
  if (action.critical.goalId !== action.node.goalId) throw new Error("Critical action Goal does not match the selected node");
  const input: CriticalActionInput & { expiresAt?: string } = {
    projectId: action.input?.projectId ?? action.node.projectId,
    action: action.critical.action, target: action.critical.target,
    policyVersion: action.input?.policyVersion ?? 1, budgetEffectCents: action.input?.budgetEffectCents ?? 0,
    ...(action.command === "approveAndRunCriticalAction" ? { expiresAt: action.critical.expiresAt } : {}),
  };
  if (action.command === "requestCriticalAction") return api.requestCriticalAction(action.node.goalId, input, commandId);
  return api.approveAndRunCriticalAction(action.node.goalId, input as Parameters<NodeActionsApi["approveAndRunCriticalAction"]>[1], commandId);
}

export interface IpPythonApprovalState {
  readonly sessionScope: string;
  readonly temporaryTools: readonly string[];
  readonly activeTier: "automatic progress" | "Department Head" | "Encore Council" | "user";
  readonly pendingDecision: string | null;
  readonly userApprovalRequest: string | null;
  readonly repetitionBudget: string;
  readonly fullAccessMode: FullAccessMode;
  readonly externalCapabilities: readonly string[];
}

/** Normalizes the non-skippable user tier invariant for the approval panel. */
export function approvalPanelFacts(state: IpPythonApprovalState): IpPythonApprovalState & { readonly userTierRequired: true } {
  return { ...state, userTierRequired: true };
}
