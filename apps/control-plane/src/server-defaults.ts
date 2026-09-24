import { DurableStoreUnavailableError } from "./goal-service.js";
import type { StartGoalOrchestrationStatusService } from "./start-goal-orchestration-status-service.js";
import { CriticalActionUnavailableError, type CriticalActionService } from "./critical-action-service.js";
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
import type { PersonaInspectionService } from "./persona-inspection-service.js";
import type {
  ChannelService,
  DiscordSignalService,
  EventService,
  InboxService,
  OrganizationService,
} from "./server-ports.js";

/**
 * Fail-closed defaults for every optional composition service.
 * Each resolver returns the injected service untouched, or a stub that
 * throws before any durable effect. Production composition (main.ts)
 * always supplies real services; tests omit them to assert fail-closed
 * behavior without inventing fake always-allow doubles.
 */
export interface ServiceDefaultsInput {
  channelService: ChannelService | undefined;
  orchestrationStatusService: StartGoalOrchestrationStatusService | undefined;
  organizationService: OrganizationService | undefined;
  eventService: EventService | undefined;
  projectionService: ProjectionService | undefined;
  personaInspectionService: PersonaInspectionService | undefined;
  readStateService: ReadStateService | undefined;
  criticalActionService: CriticalActionService | undefined;
  inboxService: InboxService | undefined;
  capabilityApprovalService: CapabilityApprovalService | undefined;
  evidenceCaptureService: EvidenceCaptureService | undefined;
  personaGoalEvidenceService: PersonaGoalEvidenceService | undefined;
  concertmasterReportService: ConcertmasterReportService | undefined;
  taskContractService: TaskContractService | undefined;
  headParticipationService: HeadParticipationService | undefined;
  councilService: CouncilService | undefined;
  departmentPlanService: DepartmentPlanService | undefined;
  missionBundleService: MissionBundleService | undefined;
  workerService: WorkerService | undefined;
  gitIntegrationService: GitIntegrationService | undefined;
  certificationService: CertificationService | undefined;
  metronomeService: MetronomeService | undefined;
  encoreService: EncoreService | undefined;
  discordSignalService: DiscordSignalService | undefined;
  conversationService: ConversationService | undefined;
}

export interface ResolvedServices {
  channels: ChannelService;
  orchestrationStatus: StartGoalOrchestrationStatusService;
  organizations: OrganizationService;
  events: EventService;
  projections: ProjectionService;
  personaInspection: PersonaInspectionService;
  readState: ReadStateService;
  criticalActions: CriticalActionService;
  inbox: InboxService;
  capabilityApprovals: Pick<CapabilityApprovalService, "selectFullAccessMode">;
  evidenceCapture: EvidenceCaptureService;
  personaGoalEvidence: PersonaGoalEvidenceService;
  concertmasterReports: ConcertmasterReportService;
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
}

function resolveOrchestrationStatus(input: StartGoalOrchestrationStatusService | undefined): StartGoalOrchestrationStatusService {
  return input ?? {
    get: async () => {
      throw new DurableStoreUnavailableError();
    },
  };
}

function resolveChannels(input: ChannelService | undefined): ChannelService {
  return (
    input ?? {
      get: async () => {
        throw new DurableStoreUnavailableError();
      },
      post: async () => {
        throw new DurableStoreUnavailableError();
      },
    }
  );
}

function resolveOrganizations(input: OrganizationService | undefined): OrganizationService {
  return (
    input ?? {
      listOrganization: async () => {
        throw new DurableStoreUnavailableError();
      },
    }
  );
}

function resolveEvents(input: EventService | undefined): EventService {
  return (
    input ?? {
      listEvents: async () => {
        throw new DurableStoreUnavailableError();
      },
    }
  );
}

function resolveProjections(input: ProjectionService | undefined): ProjectionService {
  return (
    input ?? {
      read: async () => {
        throw new DurableStoreUnavailableError();
      },
      compose: async () => {
        throw new DurableStoreUnavailableError();
      },
    }
  );
}

function resolvePersonaInspection(input: PersonaInspectionService | undefined): PersonaInspectionService {
  return (
    input ?? {
      read: async () => {
        throw new DurableStoreUnavailableError();
      },
      propose: async () => {
        throw new DurableStoreUnavailableError();
      },
      edit: async () => {
        throw new DurableStoreUnavailableError();
      },
    }
  );
}

function resolveReadState(input: ReadStateService | undefined): ReadStateService {
  return (
    input ?? {
      listGoals: async () => {
        throw new DurableStoreUnavailableError();
      },
      getBudgetSummary: async () => {
        throw new DurableStoreUnavailableError();
      },
      getBillingSummary: async () => {
        throw new DurableStoreUnavailableError();
      },
      listMetronomeChallenges: async () => {
        throw new DurableStoreUnavailableError();
      },
      listEncoreCouncilRounds: async () => {
        throw new DurableStoreUnavailableError();
      },
      listCertifications: async () => {
        throw new DurableStoreUnavailableError();
      },
      getConcertmasterReport: async () => {
        throw new DurableStoreUnavailableError();
      },
      getEvidenceBundle: async () => {
        throw new DurableStoreUnavailableError();
      },
      getGitIntegrationState: async () => {
        throw new DurableStoreUnavailableError();
      },
      listWorkersForGoal: async () => {
        throw new DurableStoreUnavailableError();
      },
      listImprovementDigestsForGoal: async () => {
        throw new DurableStoreUnavailableError();
      },
      listArrangementsForGoal: async () => {
        throw new DurableStoreUnavailableError();
      },
    }
  );
}

function resolveCriticalActions(input: CriticalActionService | undefined): CriticalActionService {
  return (
    input ?? {
      performCriticalAction: async () => {
        throw new CriticalActionUnavailableError();
      },
      approveAndPerformCriticalAction: async () => {
        throw new CriticalActionUnavailableError();
      },
      denyCriticalAction: async () => {
        throw new CriticalActionUnavailableError();
      },
    }
  );
}

function resolveInbox(input: InboxService | undefined): InboxService {
  return (
    input ?? {
      listPendingApprovals: async () => {
        throw new DurableStoreUnavailableError();
      },
    }
  );
}

function resolveCapabilityApprovals(
  input: CapabilityApprovalService | undefined,
): Pick<CapabilityApprovalService, "selectFullAccessMode"> {
  return (
    input ?? {
      selectFullAccessMode: async () => {
        throw new DurableStoreUnavailableError();
      },
    }
  );
}

function resolveEvidenceCapture(input: EvidenceCaptureService | undefined): EvidenceCaptureService {
  return (
    input ?? {
      capture: async () => {
        throw new DurableStoreUnavailableError();
      },
    }
  );
}

function resolvePersonaGoalEvidence(input: PersonaGoalEvidenceService | undefined): PersonaGoalEvidenceService {
  return (
    input ?? {
      capture: async () => {
        throw new DurableStoreUnavailableError();
      },
    }
  );
}

function resolveConcertmasterReports(input: ConcertmasterReportService | undefined): ConcertmasterReportService {
  return (
    input ?? {
      generate: async () => {
        throw new DurableStoreUnavailableError();
      },
    }
  );
}

function resolveTaskContracts(input: TaskContractService | undefined): TaskContractService {
  return (
    input ?? {
      createTaskContract: async () => {
        throw new DurableStoreUnavailableError();
      },
      getTaskContract: async () => {
        throw new DurableStoreUnavailableError();
      },
      updateTaskContract: async () => {
        throw new DurableStoreUnavailableError();
      },
      selectOvertureRoles: async () => {
        throw new DurableStoreUnavailableError();
      },
      confirmTaskContract: async () => {
        throw new DurableStoreUnavailableError();
      },
      launchTaskContract: async () => {
        throw new DurableStoreUnavailableError();
      },
    }
  );
}

function resolveHeadParticipations(input: HeadParticipationService | undefined): HeadParticipationService {
  return (
    input ?? {
      activate: async () => {
        throw new DurableStoreUnavailableError();
      },
    }
  );
}

function resolveCouncils(input: CouncilService | undefined): CouncilService {
  return (
    input ?? {
      create: async () => {
        throw new DurableStoreUnavailableError();
      },
      get: async () => {
        throw new DurableStoreUnavailableError();
      },
      submitBrief: async () => {
        throw new DurableStoreUnavailableError();
      },
      reveal: async () => {
        throw new DurableStoreUnavailableError();
      },
      decide: async () => {
        throw new DurableStoreUnavailableError();
      },
    }
  );
}

function resolveDepartmentPlans(input: DepartmentPlanService | undefined): DepartmentPlanService {
  return (
    input ?? {
      create: async () => {
        throw new DurableStoreUnavailableError();
      },
      get: async () => {
        throw new DurableStoreUnavailableError();
      },
      revise: async () => {
        throw new DurableStoreUnavailableError();
      },
    }
  );
}

function resolveMissionBundles(input: MissionBundleService | undefined): MissionBundleService {
  return (
    input ?? {
      create: async () => {
        throw new DurableStoreUnavailableError();
      },
      get: async () => {
        throw new DurableStoreUnavailableError();
      },
      issuePersonaOverlay: async () => {
        throw new DurableStoreUnavailableError();
      },
    }
  );
}

function resolveWorkers(input: WorkerService | undefined): WorkerService {
  return (
    input ?? {
      spawn: async () => {
        throw new DurableStoreUnavailableError();
      },
      get: async () => {
        throw new DurableStoreUnavailableError();
      },
      observe: async () => {
        throw new DurableStoreUnavailableError();
      },
      sendMessage: async () => {
        throw new DurableStoreUnavailableError();
      },
      cancel: async () => {
        throw new DurableStoreUnavailableError();
      },
    }
  );
}

function resolveGitIntegrations(input: GitIntegrationService | undefined): GitIntegrationService {
  return (
    input ?? {
      createGoalBranch: async () => {
        throw new DurableStoreUnavailableError();
      },
      createDepartmentBranch: async () => {
        throw new DurableStoreUnavailableError();
      },
      createWorkerWorktree: async () => {
        throw new DurableStoreUnavailableError();
      },
      advanceWorker: async () => {
        throw new DurableStoreUnavailableError();
      },
      freezeGoalRevision: async () => {
        throw new DurableStoreUnavailableError();
      },
    }
  );
}

function resolveCertifications(input: CertificationService | undefined): CertificationService {
  return (
    input ?? {
      accept: async () => {
        throw new DurableStoreUnavailableError();
      },
      certify: async () => {
        throw new DurableStoreUnavailableError();
      },
      certifyConditional: async () => {
        throw new DurableStoreUnavailableError();
      },
    }
  );
}

function resolveMetronome(input: MetronomeService | undefined): MetronomeService {
  return (
    input ?? {
      scan: async () => {
        throw new DurableStoreUnavailableError();
      },
      raise: async () => {
        throw new DurableStoreUnavailableError();
      },
      requestCorrection: async () => {
        throw new DurableStoreUnavailableError();
      },
      requestSafePause: async () => {
        throw new DurableStoreUnavailableError();
      },
      resolve: async () => {
        throw new DurableStoreUnavailableError();
      },
      challengeWorkerOverlay: async () => {
        throw new DurableStoreUnavailableError();
      },
    }
  );
}

function resolveEncore(input: EncoreService | undefined): EncoreService {
  return (
    input ?? {
      review: async () => {
        throw new DurableStoreUnavailableError();
      },
    }
  );
}

function resolveDiscordSignal(input: DiscordSignalService | undefined): DiscordSignalService {
  return (
    input ?? {
      record: async () => {
        throw new DurableStoreUnavailableError();
      },
    }
  );
}

function resolveConversations(input: ConversationService | undefined): ConversationService {
  return (
    input ?? {
      listModels: async () => {
        throw new DurableStoreUnavailableError();
      },
      create: async () => {
        throw new DurableStoreUnavailableError();
      },
      get: async () => {
        throw new DurableStoreUnavailableError();
      },
      turn: async () => {
        throw new DurableStoreUnavailableError();
      },
      cancel: async () => {
        throw new DurableStoreUnavailableError();
      },
      listEvents: async () => {
        throw new DurableStoreUnavailableError();
      },
    }
  );
}

export function resolveServiceDefaults(input: ServiceDefaultsInput): ResolvedServices {
  return {
    channels: resolveChannels(input.channelService),
    orchestrationStatus: resolveOrchestrationStatus(input.orchestrationStatusService),
    organizations: resolveOrganizations(input.organizationService),
    events: resolveEvents(input.eventService),
    projections: resolveProjections(input.projectionService),
    personaInspection: resolvePersonaInspection(input.personaInspectionService),
    readState: resolveReadState(input.readStateService),
    criticalActions: resolveCriticalActions(input.criticalActionService),
    inbox: resolveInbox(input.inboxService),
    capabilityApprovals: resolveCapabilityApprovals(input.capabilityApprovalService),
    evidenceCapture: resolveEvidenceCapture(input.evidenceCaptureService),
    personaGoalEvidence: resolvePersonaGoalEvidence(input.personaGoalEvidenceService),
    concertmasterReports: resolveConcertmasterReports(input.concertmasterReportService),
    taskContracts: resolveTaskContracts(input.taskContractService),
    headParticipations: resolveHeadParticipations(input.headParticipationService),
    councils: resolveCouncils(input.councilService),
    departmentPlans: resolveDepartmentPlans(input.departmentPlanService),
    missionBundles: resolveMissionBundles(input.missionBundleService),
    workers: resolveWorkers(input.workerService),
    gitIntegrations: resolveGitIntegrations(input.gitIntegrationService),
    certifications: resolveCertifications(input.certificationService),
    metronome: resolveMetronome(input.metronomeService),
    encore: resolveEncore(input.encoreService),
    discordSignal: resolveDiscordSignal(input.discordSignalService),
    conversations: resolveConversations(input.conversationService),
  };
}
