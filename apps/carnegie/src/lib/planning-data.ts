import type { ApiClient } from "@maestro/api-client";
import type {
  CreateHeadCouncilInput,
  DepartmentPlan,
  HeadCouncil,
  HeadCouncilDecisionInput,
  HeadParticipation,
  HeadParticipationInput,
  MissionBundle,
  OvertureRoleSelectionResult,
  OvertureSelectionInput,
  SubmitCouncilBriefInput,
} from "@maestro/contracts";

/** The exact subset of `ApiClient` the Planning screen needs, matching what `apiBridge.ts` exposes. */
export type PlanningApi = Pick<
  ApiClient,
  | "selectOvertureRoles"
  | "activateHead"
  | "createCouncil"
  | "getCouncil"
  | "submitCouncilBrief"
  | "revealCouncil"
  | "decideCouncil"
  | "getDepartmentPlan"
  | "getMissionBundle"
>;

export type PlanningStage = "overture" | "head" | "council" | "department-plan" | "mission-bundle" | "ready-for-worker";

const newId = (): string => globalThis.crypto.randomUUID();

/** Overture role selection never proceeds on a local checkbox alone -- only the server's returned selection counts as accepted. */
export function selectOvertureRolesForContract(
  api: Pick<PlanningApi, "selectOvertureRoles">,
  contractId: string,
  input: OvertureSelectionInput,
  commandId = newId(),
): Promise<OvertureRoleSelectionResult> {
  return api.selectOvertureRoles(contractId, input, commandId);
}

export function activateDepartmentHead(
  api: Pick<PlanningApi, "activateHead">,
  goalId: string,
  input: HeadParticipationInput,
  commandId = newId(),
): Promise<HeadParticipation> {
  return api.activateHead(goalId, input, commandId);
}

export function openHeadCouncil(
  api: Pick<PlanningApi, "createCouncil">,
  goalId: string,
  input: CreateHeadCouncilInput,
  commandId = newId(),
): Promise<HeadCouncil> {
  return api.createCouncil(goalId, input, commandId);
}

export function loadHeadCouncil(api: Pick<PlanningApi, "getCouncil">, councilId: string, projectId: string): Promise<HeadCouncil> {
  return api.getCouncil(councilId, projectId);
}

export function loadDepartmentPlan(
  api: Pick<PlanningApi, "getDepartmentPlan">,
  councilId: string,
  departmentId: string,
  projectId: string,
): Promise<DepartmentPlan> {
  return api.getDepartmentPlan(councilId, departmentId, projectId);
}

export function loadMissionBundle(
  api: Pick<PlanningApi, "getMissionBundle">,
  councilId: string,
  departmentId: string,
  planVersion: number,
  itemId: string,
  projectId: string,
): Promise<MissionBundle> {
  return api.getMissionBundle(councilId, departmentId, planVersion, itemId, projectId);
}

export function departmentIdFromHead(head: HeadParticipation | undefined): string | undefined {
  return head?.departmentId;
}

export function isMissionBundleSelectionValid(plan: DepartmentPlan | undefined, itemId: string): boolean {
  return plan?.substance.items.some((item) => item.itemId === itemId) ?? false;
}

export interface DepartmentPlanDetails {
  readonly scope: { readonly projectId: string; readonly goalId: string; readonly councilId: string; readonly contractId: string; readonly departmentId: string; readonly headRoleId: string; readonly version: number; readonly contentHash: string };
  readonly items: readonly { readonly itemId: string; readonly kind: string; readonly objective: string; readonly dependsOn: readonly string[]; readonly scoutQuestion: string; readonly workerAssignment: string; readonly evidenceReferences: readonly string[] }[];
  readonly constraints: readonly string[];
  readonly validation: readonly string[];
}

export function departmentPlanDetails(plan: DepartmentPlan): DepartmentPlanDetails {
  return {
    scope: {
      projectId: plan.projectId,
      goalId: plan.goalId,
      councilId: plan.councilId,
      contractId: plan.contractId,
      departmentId: plan.departmentId,
      headRoleId: plan.headRoleId,
      version: plan.version,
      contentHash: plan.contentHash,
    },
    items: plan.substance.items.map((item) => ({ ...item })),
    constraints: [
      ...plan.substance.nonGoals,
      ...plan.substance.requiredHandoffs,
      plan.substance.budgetCeiling,
      plan.substance.expectedTime,
      `max retries: ${plan.substance.maxRetries}`,
      `max workers: ${plan.substance.maxWorkers}`,
      plan.substance.gitRepository,
      plan.substance.gitBranch,
      plan.substance.integrationPath,
      ...plan.substance.risks,
      ...plan.substance.safePausePoints,
      ...plan.substance.escalationTriggers,
    ],
    validation: [...plan.substance.evidenceReferences, ...plan.substance.validationCriteria],
  };
}

export interface MissionBundleDetails {
  readonly scope: { readonly councilId: string; readonly departmentId: string; readonly planVersion: number; readonly planContentHash: string; readonly itemId: string; readonly parentRef: string; readonly contentHash: string };
  readonly workerInputs: { readonly role: string; readonly profileRef: string; readonly goalBrief: string; readonly approvedModels: readonly string[]; readonly allowedSkills: readonly string[]; readonly allowedTools: readonly string[]; readonly allowedPaths: readonly string[]; readonly environment: readonly string[]; readonly authorityBoundary: readonly string[]; readonly externalServiceBoundary: readonly string[]; readonly dataBoundary: readonly string[]; readonly costCeiling: string; readonly timeCeiling: string; readonly retryCeiling: number; readonly workerCeiling: number };
  readonly validation: { readonly deliverable: string; readonly evidenceRequirements: readonly string[]; readonly validationCriteria: readonly string[]; readonly terminationConditions: readonly string[] };
}

export function missionBundleDetails(bundle: MissionBundle): MissionBundleDetails {
  return {
    scope: {
      councilId: bundle.councilId,
      departmentId: bundle.departmentId,
      planVersion: bundle.planVersion,
      planContentHash: bundle.planContentHash,
      itemId: bundle.itemId,
      parentRef: bundle.parentRef,
      contentHash: bundle.contentHash,
    },
    workerInputs: {
      role: bundle.substance.role,
      profileRef: bundle.substance.profileRef,
      goalBrief: bundle.substance.goalBrief,
      approvedModels: [...bundle.substance.approvedModels],
      allowedSkills: [...bundle.substance.allowedSkills],
      allowedTools: [...bundle.substance.allowedTools],
      allowedPaths: [...bundle.substance.allowedPaths],
      environment: [...bundle.substance.environment],
      authorityBoundary: [...bundle.substance.authorityBoundary],
      externalServiceBoundary: [...bundle.substance.externalServiceBoundary],
      dataBoundary: [...bundle.substance.dataBoundary],
      costCeiling: bundle.substance.costCeiling,
      timeCeiling: bundle.substance.timeCeiling,
      retryCeiling: bundle.substance.retryCeiling,
      workerCeiling: bundle.substance.workerCeiling,
    },
    validation: {
      deliverable: bundle.substance.deliverable,
      evidenceRequirements: [...bundle.substance.evidenceRequirements],
      validationCriteria: [...bundle.substance.validationCriteria],
      terminationConditions: [...bundle.substance.terminationConditions],
    },
  };
}

/** A Department can only submit its own brief; the caller supplies the exact `departmentId` its Head activation returned. */
export function submitDepartmentBrief(
  api: Pick<PlanningApi, "submitCouncilBrief">,
  councilId: string,
  departmentId: string,
  input: SubmitCouncilBriefInput,
  commandId = newId(),
): Promise<void> {
  return api.submitCouncilBrief(councilId, departmentId, input, commandId);
}

/** Reveal is a separate, explicit action -- never triggered automatically after a brief submission. */
export function revealHeadCouncil(
  api: Pick<PlanningApi, "revealCouncil">,
  councilId: string,
  projectId: string,
  commandId = newId(),
): Promise<void> {
  return api.revealCouncil(councilId, projectId, commandId);
}

/** Decide is likewise a separate, explicit action -- never auto-run after reveal. */
export function decideHeadCouncil(
  api: Pick<PlanningApi, "decideCouncil">,
  councilId: string,
  input: HeadCouncilDecisionInput,
  commandId = newId(),
): Promise<HeadCouncil> {
  return api.decideCouncil(councilId, input, commandId);
}

/** Determines the furthest stage the operator can currently act on from real, already-loaded server state -- never advances past what the server has actually confirmed. */
export function currentPlanningStage(input: {
  overtureSelected: boolean;
  headActive: boolean;
  council: HeadCouncil | undefined;
  departmentPlanExists: boolean;
  missionBundleExists: boolean;
}): PlanningStage {
  if (!input.overtureSelected) return "overture";
  if (!input.headActive) return "head";
  if (input.council === undefined || input.council.state !== "resolved") return "council";
  if (!input.departmentPlanExists) return "department-plan";
  if (!input.missionBundleExists) return "mission-bundle";
  return "ready-for-worker";
}
