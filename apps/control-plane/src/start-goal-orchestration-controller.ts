import type { HeadParticipationInput } from "@maestro/contracts";
import { deriveCouncilCreationCommandId, deriveHeadActivationCommandId } from "@maestro/domain";
import type { Pool } from "pg";
import {
  beginStartGoalOrchestration,
  CouncilProtocolError,
  recordStartGoalOrchestrationState,
  type ValidatedStartGoalOrchestrationCommand,
  type StartGoalOrchestrationRun,
  type StartGoalOrchestrationStateInput,
} from "@maestro/persistence";
import type { GoalService } from "./goal-service.js";
import type { HeadParticipationService } from "./head-participation-service.js";
import type { CouncilService } from "./council-service.js";

export interface StartGoalOrchestrationControllerDependencies {
  pool: Pool;
  goalService: Pick<GoalService, "getGoal" | "transitionGoal">;
  headParticipationService: Pick<HeadParticipationService, "activate">;
  councilService: Pick<CouncilService, "create">;
  begin?: typeof beginStartGoalOrchestration;
  record?: typeof recordStartGoalOrchestrationState;
}

export interface StartGoalOrchestrationController {
  execute(command: ValidatedStartGoalOrchestrationCommand): Promise<StartGoalOrchestrationRun>;
}

class BlockedStartGoalError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "BlockedStartGoalError";
  }
}

export function createStartGoalOrchestrationController(
  deps: StartGoalOrchestrationControllerDependencies,
): StartGoalOrchestrationController {
  const begin = deps.begin ?? beginStartGoalOrchestration;
  const record = deps.record ?? recordStartGoalOrchestrationState;

  return {
    async execute(command) {
      const plan = command.headActivationPlan;
      const run = await begin(
        deps.pool,
        { ...command, actorId: command.actorId ?? null, headActivationPlanHash: plan?.contentHash ?? null },
        plan?.contentHash ?? null,
      );
      if (run.state !== "running") return run;
      if (command.actorId === undefined)
        return transitionState(run, record, deps.pool, {
          goalId: command.goalId,
          commandId: command.commandId,
          eventKey: `${command.commandId}:missing-operator-authority`,
          state: "blocked",
          reason: "missing_operator_authority",
        });
      if (plan === undefined)
        return transitionState(run, record, deps.pool, {
          goalId: command.goalId,
          commandId: command.commandId,
          eventKey: `${command.commandId}:missing-head-plan`,
          state: "blocked",
          reason: "missing_head_activation_plan",
        });
      if (run.stage === "briefs_pending") return run;
      if (run.stage === "council_creation") return createCouncil(run, command, plan, deps, record);

      try {
        let goal = await deps.goalService.getGoal(command.goalId, command.projectId);
        const operator = { operatorId: command.actorId, credentialId: "start-goal-orchestrator" };
        for (const to of ["ready_for_confirmation", "launched", "active"] as const) {
          if (goal.state === "active") break;
          if (goal.state !== "draft" && goal.state !== "ready_for_confirmation" && goal.state !== "launched") {
            throw new BlockedStartGoalError(`goal_state_${goal.state}`);
          }
          const expected = goal.version;
          const next =
            to === "ready_for_confirmation" && goal.state !== "draft"
              ? undefined
              : to === "launched" && goal.state !== "ready_for_confirmation"
                ? undefined
                : to === "active" && goal.state !== "launched"
                  ? undefined
                  : to;
          if (next === undefined) continue;
          goal = await deps.goalService.transitionGoal(
            command.goalId,
            { projectId: command.projectId, expectedVersion: expected, to: next },
            `${command.commandId}:goal-${next}`,
            operator,
          );
        }
        for (const brief of plan.departments) {
          const input: HeadParticipationInput = {
            projectId: command.projectId,
            departmentId: brief.departmentId,
            contractId: command.taskContractId,
            requestedContribution: brief.requestedContribution,
            urgency: brief.urgency,
            contextScope: brief.contextScope,
            budgetEffect: brief.budgetEffect,
            reason: brief.reason,
            evidence: { taskContractContentHash: command.contentHash, headActivationPlanHash: plan.contentHash },
          };
          const participation = await deps.headParticipationService.activate(
            command.goalId,
            input,
            operator,
            deriveHeadActivationCommandId(command.commandId, brief.departmentId),
          );
          if (participation.status !== "active") throw new Error("Head activation outcome is not yet durable active");
        }
        const councilRun = await transitionState(run, record, deps.pool, {
          goalId: command.goalId,
          commandId: command.commandId,
          eventKey: `${command.commandId}:head-activation-complete`,
          stage: "council_creation",
          state: "running",
          reason: "head_activation_complete",
          details: { stage: "head_activation", nextStage: "council_creation" },
        });
        return createCouncil(councilRun, command, plan, deps, record);
      } catch (error) {
        if (error instanceof BlockedStartGoalError)
          return transitionState(run, record, deps.pool, {
            goalId: command.goalId,
            commandId: command.commandId,
            eventKey: `${command.commandId}:blocked`,
            state: "blocked",
            reason: error.reason,
          });
        return transitionState(run, record, deps.pool, {
          goalId: command.goalId,
          commandId: command.commandId,
          eventKey: `${command.commandId}:unknown`,
          state: "unknown",
          reason: "head_activation_outcome_unknown",
        });
      }
    },
  };
}

async function createCouncil(
  run: StartGoalOrchestrationRun,
  command: ValidatedStartGoalOrchestrationCommand,
  plan: NonNullable<ValidatedStartGoalOrchestrationCommand["headActivationPlan"]>,
  deps: StartGoalOrchestrationControllerDependencies,
  record: typeof recordStartGoalOrchestrationState,
): Promise<StartGoalOrchestrationRun> {
  const operator = { operatorId: command.actorId!, credentialId: "start-goal-orchestrator" };
  try {
    const council = await deps.councilService.create(
      command.goalId,
      {
        projectId: command.projectId,
        contractId: command.taskContractId,
        briefDeadline: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
        evidence: { headActivationPlanHash: plan.contentHash, evidenceReferences: [] },
      },
      deriveCouncilCreationCommandId(command.commandId, command.goalId),
      operator,
    );
    return transitionState(run, record, deps.pool, {
      goalId: command.goalId,
      commandId: command.commandId,
      eventKey: `${command.commandId}:council-created`,
      stage: "briefs_pending",
      state: "running",
      reason: "council_created",
      details: { councilId: council.councilId, nextStage: "brief_submission" },
    });
  } catch (error) {
    return transitionState(run, record, deps.pool, {
      goalId: command.goalId,
      commandId: command.commandId,
      eventKey: `${command.commandId}:council-blocked`,
      stage: "council_creation",
      state: error instanceof CouncilProtocolError ? "blocked" : "unknown",
      reason: error instanceof CouncilProtocolError ? "council_creation_blocked" : "council_creation_outcome_unknown",
    });
  }
}

async function transitionState(
  run: StartGoalOrchestrationRun,
  record: typeof recordStartGoalOrchestrationState,
  pool: Pool,
  input: StartGoalOrchestrationStateInput,
): Promise<StartGoalOrchestrationRun> {
  const recorded = await record(pool, input);
  return recorded ?? { ...run, stage: input.stage ?? run.stage, state: input.state, reason: input.reason };
}
