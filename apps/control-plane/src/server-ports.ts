import type { EventCursor } from "@maestro/contracts";
import type { AccountLoginStore, OperatorAuthentication, OperatorContext } from "@maestro/persistence";
import type { PersonaInspectionService } from "./persona-inspection-service.js";
import type { OvertureService } from "./overture-service.js";
import type { StartGoalOrchestrationStatusService } from "./start-goal-orchestration-status-service.js";
import type { RouterCatalogService } from "./composition/router-catalog.js";

import { type GoalService } from "./goal-service.js";
import { type CriticalActionService } from "./critical-action-service.js";
import { type ReadStateService } from "./read-state-service.js";
import type { ProjectionService } from "./projection-service.js";
import { type TaskContractService } from "./task-contract-service.js";
import { type HeadParticipationService } from "./head-participation-service.js";
import { type CouncilService } from "./council-service.js";
import { type DepartmentPlanService } from "./department-plan-service.js";
import { type CapabilityApprovalService } from "./capability-approval-service.js";
import { type EvidenceCaptureService } from "./evidence-capture-service.js";
import type { ConcertmasterReportService } from "./concertmaster-report-service.js";
import { type MissionBundleService } from "./mission-bundle-service.js";
import { type WorkerService } from "./worker-service.js";
import { type ConversationService } from "./conversation-service.js";

import { type GitIntegrationService } from "./git-integration-service.js";
import type { CertificationService } from "./certification-service.js";
import type { PersonaGoalEvidenceService } from "./persona-goal-evidence-service.js";
import type { MetronomeService } from "./metronome-service.js";
import { type EncoreService } from "./encore-service.js";
import { type StoredDiscordSignal } from "@maestro/persistence";

import type { AuthenticatedDiscordSignal } from "@maestro/domain";

export interface DiscordSignalService {
  record(envelope: AuthenticatedDiscordSignal): Promise<StoredDiscordSignal>;
}

export type ReadStateUnavailableService = ReadStateService;

export interface EventService {
  listEvents(projectId: string, after: EventCursor): Promise<import("@maestro/contracts").GoalEvent[]>;
}

export interface PlanDecisionService {
  /** Approve a plan awaiting the operator, or send it back to the Heads with a note. */
  decide(goalId: string, input: import("@maestro/contracts").GoalPlanDecisionInput, operator: OperatorContext): Promise<void>;
}

export interface ProjectDiscoveryService {
  /** Lists only active projects visible to this authenticated operator. */
  listProjects(operatorId: string): Promise<readonly string[]>;
  /** Named projects (Home first) with Goal counts. */
  listCatalog?(operatorId: string): Promise<readonly import("@maestro/contracts").ProjectSummary[]>;
  create?(operatorId: string, name: string, commandId: string): Promise<import("@maestro/contracts").ProjectSummary>;
  rename?(operatorId: string, projectId: string, name: string): Promise<import("@maestro/contracts").ProjectSummary>;
}

export interface InboxService {
  listPendingApprovals(projectId: string, operator: OperatorContext): Promise<import("@maestro/contracts").InboxRead>;
}

export interface ChannelService {
  get(input: {
    operatorId: string;
    projectId: string;
    goalId: string;
    selector: import("@maestro/domain").ChannelSelector;
  }): Promise<import("@maestro/contracts").ChannelRead>;
  post(input: {
    operatorId: string;
    projectId: string;
    goalId: string;
    selector: import("@maestro/domain").ChannelSelector;
    content: string;
    messageId: string;
  }): Promise<import("@maestro/contracts").ChannelMessage>;
}

export interface OrganizationService {
  /** Returns the standing taxonomy; authentication is enforced by the route hook. */
  listOrganization(): Promise<import("@maestro/contracts").OrganizationReadModel>;
}

export interface ProviderCredentialService {
  bind(input: {
    operatorId: string;
    requestId: string;
    providerId: "openai" | "anthropic";
    authMode: "api-key";
    secret: string;
  }): Promise<import("@maestro/agent-runtime").GatewayCredentialBinding>;
  revoke(input: { operatorId: string; requestId: string; providerId: "openai" | "anthropic" }): Promise<void>;
  list?(): Promise<readonly import("@maestro/contracts").SettingsProvider[]>;
  startAccountLogin?(input: {
    operatorId: string;
    requestId: string;
    providerId: "openai-codex" | "anthropic-claude";
  }): Promise<import("@maestro/agent-runtime").GatewayAccountLoginStartResult>;
  accountLoginStatus?(input: {
    operatorId: string;
    requestId: string;
    providerId: "openai-codex" | "anthropic-claude";
    loginId: string;
  }): Promise<import("@maestro/agent-runtime").GatewayAccountLoginStatusResult>;
  cancelAccountLogin?(input: {
    operatorId: string;
    requestId: string;
    providerId: "openai-codex" | "anthropic-claude";
    loginId: string;
  }): Promise<void>;
  logoutAccount?(input: { operatorId: string; requestId: string; providerId: "openai-codex" | "anthropic-claude" }): Promise<void>;
}

export interface SettingsService {
  get(operatorId: string): Promise<import("@maestro/contracts").SettingsRead>;
  updatePreferences(
    operatorId: string,
    patch: import("@maestro/contracts").SettingsPreferencesUpdate,
  ): Promise<import("@maestro/contracts").SettingsRead>;
  updateModelPool(
    operatorId: string,
    patch: import("@maestro/contracts").SettingsModelPoolUpdate,
  ): Promise<import("@maestro/contracts").SettingsRead>;
  replaceModelPool(
    operatorId: string,
    input: import("@maestro/contracts").SettingsModelPoolConfig,
  ): Promise<import("@maestro/contracts").SettingsRead>;
  updateAuthorityDefaults(
    operatorId: string,
    patch: import("@maestro/contracts").SettingsAuthorityDefaultsUpdate,
  ): Promise<import("@maestro/contracts").SettingsRead>;
}

export interface OperatorAuthenticator {
  authenticateBearerSecret(secret: string): Promise<OperatorAuthentication>;
}

export class ProjectAccessForbiddenError extends Error {}

export interface ProjectMembershipChecker {
  /** Fails closed unless the operator currently holds an active membership for this exact project. */
  assertProjectMembership(operatorId: string, projectId: string): Promise<void>;
}

export interface ProjectAccessProvisioner {
  /** Grants a target operator exact standing project roles under an explicit admin policy. */
  provisionProjectAccess(
    requesterOperatorId: string,
    input: import("@maestro/contracts").ProjectAccessProvisionInput,
  ): Promise<import("@maestro/contracts").ProjectAccessProvisionResult>;
}

export interface PollingScheduler {
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface RouteDeps {
  goalService: GoalService;
  orchestrationStatus: StartGoalOrchestrationStatusService;
  events: EventService;
  criticalActions: CriticalActionService;
  capabilityApprovals: Pick<CapabilityApprovalService, "selectFullAccessMode">;
  inbox: InboxService;
  evidenceCapture: EvidenceCaptureService;
  personaGoalEvidence: PersonaGoalEvidenceService;
  concertmasterReports: ConcertmasterReportService;
  pollingScheduler: PollingScheduler;
  readState: ReadStateService;
  taskContracts: TaskContractService;
  headParticipations: HeadParticipationService;
  councils: CouncilService;
  departmentPlans: DepartmentPlanService;
  missionBundles: MissionBundleService;
  workers: WorkerService;
  gitIntegrations: GitIntegrationService;
  certifications: CertificationService;
  metronome: MetronomeService;
  encore: EncoreService;
  discordSignal: DiscordSignalService;
  conversations: ConversationService;
  overture?: OvertureService;
  sessionWorkspace?: import("./session-workspace.js").SessionWorkspace;
  projections: ProjectionService;
  personaInspection: PersonaInspectionService;
  organizations: OrganizationService;
  channels: ChannelService;
  loginOwnerId: string;
  loginOperationStaleAfterMs: number;
  activeStreams: Set<() => void>;
  maxActiveStreams: number;
  authenticator: OperatorAuthenticator;
  projectAccess?: ProjectAccessProvisioner;
  projectDiscovery?: ProjectDiscoveryService;
  planDecisions?: PlanDecisionService;
  providerCredentials?: ProviderCredentialService;
  accountLoginStore?: AccountLoginStore;
  settingsService?: SettingsService;
  routerCatalogService?: RouterCatalogService;
  projectMembership?: ProjectMembershipChecker;
}
