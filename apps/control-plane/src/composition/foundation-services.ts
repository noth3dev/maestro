import type { Pool } from "pg";
import type { PersonaAxis } from "@maestro/domain";
import type { ModelGatewayPort } from "@maestro/agent-runtime";
import type { MaestroConfig } from "../config.js";
import type { ControlPlaneOverrides } from "../main.js";
import { PERSONA_AXES } from "@maestro/domain";
import {
  assertProjectMembership,
  authenticateLocalOperator,
  getGoalControl,
  readActivePersonaProfile,
  type PostgresAuthorityRepository,
} from "@maestro/persistence";
import type { OperatorAuthenticator } from "../server.js";
import { FileEvidenceStore } from "@maestro/evidence";
import {
  createCriticalActionService,
  CriticalActionGoalNotFoundError,
  CriticalActionProjectMismatchError,
} from "../critical-action-service.js";
import { createCapabilityApprovalService } from "../capability-approval-service.js";
import { createEvidenceCaptureService, EvidenceCaptureGoalBindingError } from "../evidence-capture-service.js";
import { createPersonaGoalEvidenceService } from "../persona-goal-evidence-service.js";
import { createPersonaInspectionService } from "../persona-inspection-service.js";
import { createDurableGoalService, requireGoalLease } from "../goal-service.js";
import { createDurableTaskContractService } from "../task-contract-service.js";
import { createPostgresConversationService } from "../conversation-service.js";

export interface FoundationServicesDeps {
  pool: Pool;
  config: MaestroConfig;
  overrides: ControlPlaneOverrides;
  authorityRepository: PostgresAuthorityRepository;
  modelGateway?: ModelGatewayPort | undefined;
}

export function composeFoundationServices(deps: FoundationServicesDeps) {
  const { pool, config, overrides, authorityRepository, modelGateway } = deps;
  function parseConversationMissionOverlay(value: unknown): Readonly<Partial<Record<PersonaAxis, number>>> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("stored mission persona overlay is invalid");
    const result: Partial<Record<PersonaAxis, number>> = {};
    for (const [axis, raw] of Object.entries(value)) {
      if (!PERSONA_AXES.includes(axis as PersonaAxis) || typeof raw !== "number" || !Number.isFinite(raw) || raw < -1 || raw > 1)
        throw new Error("stored mission persona overlay is invalid");
      result[axis as PersonaAxis] = raw;
    }
    return result;
  }

  const taskContractService = createDurableTaskContractService(pool);
  const conversationPersonaResolver = async (input: {
    readonly roleId: string;
    readonly taskClass: string;
    readonly projectId: string;
    readonly goalId: string | null;
  }) => {
    let taskClass = input.taskClass;
    let missionOverlay: Readonly<Partial<Record<PersonaAxis, number>>> = {};
    if (input.goalId !== null) {
      const evidence = await pool.query<{ task_class: string; mission_overlay: unknown }>(
        "SELECT task_class, mission_overlay FROM persona_goal_evidence WHERE goal_id = $1 AND project_id = $2 AND role_id = $3 ORDER BY created_at DESC, evidence_id DESC LIMIT 1",
        [input.goalId, input.projectId, input.roleId],
      );
      const row = evidence.rows[0];
      if (row !== undefined) {
        taskClass = row.task_class;
        missionOverlay = parseConversationMissionOverlay(row.mission_overlay);
      }
    }
    const active = await readActivePersonaProfile(pool, input.roleId, taskClass, missionOverlay);
    return {
      roleId: input.roleId,
      taskClass,
      profile: active.persona,
      mission: active.coreIdentity.mission,
      authority: active.coreIdentity.authority,
      truthfulness: active.coreIdentity.truthfulness,
      safety: active.coreIdentity.safety,
      prohibitedBehavior: active.coreIdentity.prohibitedBehavior,
    };
  };
  const conversationService =
    modelGateway === undefined
      ? undefined
      : createPostgresConversationService({
          pool,
          gateway: modelGateway,
          gatewayOperatorId: config.modelGatewayOperatorId,
          accountRefs: config.modelAccountRefs,
          taskContractService,
          personaResolver: conversationPersonaResolver,
        });
  const goalService = createDurableGoalService({
    pool,
    actorId: config.actorId,
    leaseOwnerId: config.leaseOwnerId,
  });
  const withGoalLease = requireGoalLease(goalService);
  const authenticator: OperatorAuthenticator = {
    authenticateBearerSecret: (secret) => authenticateLocalOperator(pool, secret),
  };
  const externalDeploymentGate: {
    require?: (input: { projectId: string; goalId: string; commandId: string; budgetEffectCents: number }) => Promise<void>;
  } = {};
  const criticalActionService = createCriticalActionService({
    pool,
    ...(config.ceoOperatorId === undefined ? {} : { ceoOperatorId: config.ceoOperatorId }),
    repository: authorityRepository,
    getControlEpoch: async (projectId, goalId) => (await getGoalControl(pool, projectId, goalId)).controlEpoch,
    assertGoalProjectBinding: async (projectId, goalId) => {
      const goal = await pool.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1", [goalId]);
      if (goal.rowCount !== 1) throw new CriticalActionGoalNotFoundError();
      if (goal.rows[0]!.project_id !== projectId) throw new CriticalActionProjectMismatchError();
    },
    // Do not claim an authorized effect when no concrete adapter is composed.
    // A missing production adapter fails closed instead of returning allow for
    // a no-op callback. Tests may inject a real observable effect.
    effect:
      overrides.criticalActionEffect ??
      (async () => {
        throw new Error("No critical-action effect adapter is configured");
      }),
    requireExternalCapability: async (input) => {
      if (externalDeploymentGate.require === undefined) throw new Error("External deployment capability gate is not configured");
      await externalDeploymentGate.require(input);
    },
  });
  const capabilityApprovalService = createCapabilityApprovalService({
    pool,
    resolveDepartmentHead: async () => undefined,
    resolveEncoreCouncil: async () => undefined,
    authorizeActor: async ({ actor, projectId, goalId }) => {
      if (actor.kind !== "user" || actor.projectId !== projectId || actor.goalId !== goalId || actor.active !== true) return false;
      await assertProjectMembership(pool, actor.actorId, projectId);
      const goal = await pool.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1", [goalId]);
      return goal.rowCount === 1 && goal.rows[0]!.project_id === projectId;
    },
  });
  externalDeploymentGate.require = async ({ projectId, goalId, commandId, budgetEffectCents }) => {
    await capabilityApprovalService.consumeExternalCapability({
      capabilityKind: "deployment",
      projectId,
      goalId,
      commandId,
      budgetEffectCents,
    });
  };
  const evidenceCaptureService = createEvidenceCaptureService({
    pool,
    store: new FileEvidenceStore(config.evidenceDir),
    assertGoalProjectBinding: async (projectId, goalId) => {
      const goal = await pool.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1", [goalId]);
      if (goal.rowCount !== 1 || goal.rows[0]!.project_id !== projectId) throw new EvidenceCaptureGoalBindingError();
    },
  });
  const personaGoalEvidenceService = createPersonaGoalEvidenceService({ pool });
  const personaInspectionService = createPersonaInspectionService({ pool, withGoalLease });
  return {
    taskContractService,
    conversationService,
    goalService,
    withGoalLease,
    authenticator,
    criticalActionService,
    capabilityApprovalService,
    evidenceCaptureService,
    personaGoalEvidenceService,
    personaInspectionService,
  };
}
