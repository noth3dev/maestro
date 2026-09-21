import type { ApiClient } from "@maestro/api-client";
import type {
  CreateHeadCouncilInput,
  HeadCouncil,
  HeadCouncilDecisionInput,
  HeadParticipation,
  HeadParticipationInput,
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
