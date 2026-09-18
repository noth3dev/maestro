import { resolve } from "node:path";
import type { Pool } from "pg";
import type { ExecutionAdmission, ExecutionKernelPort } from "@maestro/domain";
import type { AuthorizedEffectExecutor } from "@maestro/authority";
import type { ModelGatewayPort } from "@maestro/agent-runtime";
import type { MaestroConfig } from "../config.js";
import type { ControlPlaneOverrides } from "../main.js";
import type { composeFoundationServices } from "./foundation-services.js";
import { createPinnedNativeAdmission, type NativeAdmissionInput } from "../native-admission.js";
import { createEnsembleNativeAdmission } from "../ensemble-admission.js";
import { readRoutingCandidateCatalog } from "../ensemble-candidate-catalog.js";
import { createLocalGitPort } from "@maestro/git-adapter";
import {
  ensureCapacityInventory,
  getGoalControl,
  readRoutingWorkSnapshot,
  readWorkerBySpawnCommand,
  releaseCapacityReservation,
  requeueCapacityReservation,
  reserveCapacity,
} from "@maestro/persistence";
import { createHeadParticipationService } from "../head-participation-service.js";
import { createCouncilService } from "../council-service.js";
import { createDepartmentPlanService } from "../department-plan-service.js";
import { createMissionBundleService } from "../mission-bundle-service.js";
import { createGitIntegrationService } from "../git-integration-service.js";
import { createWorkerService } from "../worker-service.js";
import { createCertificationService } from "../certification-service.js";
import { createConcertmasterReportService } from "../concertmaster-report-service.js";
import { createMetronomeService } from "../metronome-service.js";
import { createEncoreService } from "../encore-service.js";

export interface ExecutionServicesDeps {
  pool: Pool;
  config: MaestroConfig;
  overrides: ControlPlaneOverrides;
  withGoalLease: ReturnType<typeof composeFoundationServices>["withGoalLease"];
  executionKernel: ExecutionKernelPort;
  authorityExecutor: AuthorizedEffectExecutor;
  modelGateway?: ModelGatewayPort | undefined;
}

export function composeExecutionServices(deps: ExecutionServicesDeps) {
  const { pool, config, overrides, withGoalLease, executionKernel, authorityExecutor, modelGateway } = deps;
  const nativeAdmission =
    overrides.nativeAdmission ??
    (modelGateway === undefined ? undefined : (input: NativeAdmissionInput) => createHostNativeAdmission(config, input));
  function createHostNativeAdmission(config: MaestroConfig, input: NativeAdmissionInput): ExecutionAdmission {
    if (config.modelRoutingMode !== "pin") throw new Error("Native host admission requires pin routing mode");
    return createPinnedNativeAdmission(config, input);
  }

  const headParticipationService = createHeadParticipationService({
    pool,
    kernel: executionKernel,
    withGoalLease,
    ...(nativeAdmission === undefined ? {} : { createAdmission: (input) => nativeAdmission({ purpose: "head", ...input }) }),
  });
  const councilService = createCouncilService({ pool, withGoalLease });
  const departmentPlanService = createDepartmentPlanService({ pool, withGoalLease });
  const missionBundleService = createMissionBundleService({ pool, withGoalLease });
  const gitIntegrationService = createGitIntegrationService({
    pool,
    workspaceRoot: config.worktreeRoot,
    withGoalLease,
    createGitPort: (context) =>
      overrides.gitPort ?? createLocalGitPort({ authority: authorityExecutor, context, workspaceRoot: config.worktreeRoot }),
    getControlEpoch: async (projectId, goalId) => (await getGoalControl(pool, projectId, goalId)).controlEpoch,
  });
  const capacityEnabled =
    config.maxConcurrentWorkersPerProject !== undefined ||
    config.capacityProviderRate !== undefined ||
    config.capacitySpendCents !== undefined ||
    config.capacityProviderRateFloor !== undefined ||
    config.capacitySpendCentsFloor !== undefined ||
    config.capacityWorkerSlotsFloor !== undefined;
  const capacity = capacityEnabled
    ? {
        reserve: async (demand: import("@maestro/domain").CapacityDemand) => {
          await ensureCapacityInventory(pool, {
            projectId: demand.projectId,
            providerRate: config.capacityProviderRate ?? 2_147_483_647,
            spendCents: config.capacitySpendCents ?? 2_147_483_647,
            workerSlots: config.maxConcurrentWorkersPerProject ?? 2_147_483_647,
            ...(config.capacityProviderRateFloor === undefined ? {} : { providerRateFloor: config.capacityProviderRateFloor }),
            ...(config.capacitySpendCentsFloor === undefined ? {} : { spendCentsFloor: config.capacitySpendCentsFloor }),
            ...(config.capacityWorkerSlotsFloor === undefined ? {} : { workerSlotsFloor: config.capacityWorkerSlotsFloor }),
          });
          const admission = await reserveCapacity(pool, demand);
          if (admission.kind === "reserved") return { kind: "reserved" as const, reservationId: admission.reservation.reservationId };
          if (admission.kind === "queued") return { kind: "queued" as const, queueId: admission.reservationId, reason: admission.reason };
          if (admission.reservation.status === "released") {
            const worker = await readWorkerBySpawnCommand(pool, demand.commandId);
            if (worker === undefined) throw new Error("Capacity command was already released");
          }
          return { kind: "reserved" as const, reservationId: admission.reservation.reservationId };
        },
        release: (reservationId: string) => releaseCapacityReservation(pool, reservationId).then(() => undefined),
        requeue: (reservationId: string) => requeueCapacityReservation(pool, reservationId).then(() => undefined),
      }
    : undefined;
  const ensembleAdmission =
    config.modelRoutingMode === "ensemble"
      ? async (input: import("@maestro/persistence").WorkerAdmissionFactoryInput) => {
          const catalogPath = config.ensembleCandidateCatalogPath;
          if (catalogPath === undefined) throw new Error("Ensemble candidate catalog is not configured");
          const goalId = input.base.context.goalId;
          if (typeof goalId !== "string" || goalId.trim() === "") throw new Error("Ensemble admission requires a Goal-bound context");
          const snapshot = await readRoutingWorkSnapshot(pool, {
            councilId: input.bundle.councilId,
            departmentId: input.bundle.departmentId,
            planVersion: input.bundle.planVersion,
            itemId: input.bundle.itemId,
            goalRef: goalId,
            projectRef: input.base.context.projectId,
          });
          const catalog = readRoutingCandidateCatalog({ modelMapPath: resolve(process.cwd(), "config/model_map.json"), catalogPath });
          return createEnsembleNativeAdmission(config, { snapshot, ...catalog, routeRef: input.routeRef, base: input.base });
        }
      : undefined;
  const workerService = createWorkerService({
    modelRoutingMode: config.modelRoutingMode,
    ...(config.nativeModelRef === undefined ? {} : { nativeModelRef: config.nativeModelRef }),
    ...(ensembleAdmission === undefined ? {} : { createEnsembleAdmission: ensembleAdmission }),
    pool,
    kernel: executionKernel,
    workspaceRoot: config.worktreeRoot,
    withGoalLease,
    prepareWorkerWorktree: (workerId, input, operatorId, commandId) =>
      gitIntegrationService.createWorkerWorktree(workerId, input, operatorId, commandId),
    ...(config.maxConcurrentWorkersPerProject === undefined
      ? {}
      : { maxConcurrentWorkersPerProject: config.maxConcurrentWorkersPerProject }),
    ...(capacity === undefined ? {} : { capacity }),
  });
  const certificationService = createCertificationService({ pool, withGoalLease });
  const concertmasterReportService = createConcertmasterReportService({ pool, withGoalLease });
  const metronomeService = createMetronomeService({ pool, withGoalLease });
  const encoreService = createEncoreService({
    pool,
    kernel: executionKernel,
    withGoalLease,
    ...(nativeAdmission === undefined ? {} : { createAdmission: (input) => nativeAdmission({ purpose: "encore", ...input }) }),
  });
  return {
    headParticipationService,
    councilService,
    departmentPlanService,
    missionBundleService,
    gitIntegrationService,
    workerService,
    certificationService,
    concertmasterReportService,
    metronomeService,
    encoreService,
  };
}
