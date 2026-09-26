import type { Pool } from "pg";
import type { EncoreCouncilResult, EncoreReviewInput, GoalPlanDecisionInput } from "@maestro/contracts";
import { canonicalJson, deriveStableCommandId } from "@maestro/domain";
import { readGoalPlanVersion, readHeadCouncil, readLatestGoalPlan, setGoalPlanStatus } from "@maestro/persistence";
import { PLAN_REVIEW_CRITERIA, planReviewQuestion } from "@maestro/prompts";

export type PlanApprovalOutcome = "approved" | "awaiting_operator";

export interface PlanApprovalDependencies {
  readonly pool: Pool;
  readonly review: (goalId: string, input: EncoreReviewInput, commandId: string) => Promise<EncoreCouncilResult>;
  /** The lead writes a new plan version that resolves the objections. */
  readonly revise: (input: { readonly goalId: string; readonly councilId: string; readonly objections: string }) => Promise<number>;
  /** Tell #head-council (as the chair). */
  readonly announce: (goalId: string, content: string) => Promise<void>;
  readonly reviewerCount?: number;
  /** Encore rejections the lead may answer with a revision before the operator decides. */
  readonly maxRevisions?: number;
}

function objectionsOf(result: EncoreCouncilResult): string {
  return result.judgments
    .filter((judgment) => judgment.verdict !== "proceed")
    .map((judgment) => [judgment.reasoning, ...judgment.conditions.map((condition) => `- ${condition}`)].join("\n"))
    .join("\n");
}

/**
 * The Encore Council approves the Heads' plan before any Worker starts. A
 * unanimous rejection goes back to the lead for a revision; an escalation (or
 * a rejection after the revisions) waits for the operator's decision.
 */
export function createPlanApprovalRuntime(deps: PlanApprovalDependencies) {
  const reviewerCount = deps.reviewerCount ?? 3;
  const maxRevisions = deps.maxRevisions ?? 1;
  return {
    async run({ goalId, councilId }: { readonly goalId: string; readonly councilId: string }): Promise<PlanApprovalOutcome> {
      const council = await readHeadCouncil(deps.pool, councilId);
      for (;;) {
        const goal = await deps.pool.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1", [goalId]);
        const projectId = goal.rows[0]!.project_id;
        const plan = await readLatestGoalPlan(deps.pool, goalId, projectId);
        if (plan.status === "approved") return "approved";
        if (plan.status === "awaiting_approval") return "awaiting_operator";
        const substance = { phases: plan.phases, slices: plan.slices.map(({ status: _status, statusReason: _reason, ...slice }) => slice) };
        const result = await deps.review(
          goalId,
          {
            projectId,
            question: planReviewQuestion({ contractJson: canonicalJson(council.snapshot.contract.content), planJson: JSON.stringify(substance), version: plan.version }),
            criteria: PLAN_REVIEW_CRITERIA.map((criterion) => ({ ...criterion })),
            evidenceIds: [],
            reviewerCount,
          },
          deriveStableCommandId(`maestro:plan-review:${goalId}:${plan.version}:${plan.contentHash}`),
        );
        const verdict = result.synthesis.finalVerdict;
        const ref = `encore:${result.roundId}`;
        if (verdict === "proceed") {
          await setGoalPlanStatus(deps.pool, { goalId, version: plan.version, status: "approved", approvalRef: ref, note: "Approved by the Encore Council" });
          await deps.announce(goalId, `The Encore Council approved plan v${plan.version}. Its slices are ready for dispatch.`);
          return "approved";
        }
        const objections = objectionsOf(result) || "The reviewers did not agree.";
        if (verdict === "do_not_proceed" && plan.version <= maxRevisions) {
          await deps.announce(goalId, `The Encore Council sent plan v${plan.version} back:\n${objections}`);
          await deps.revise({ goalId, councilId, objections: `Encore Council:\n${objections}` });
          continue;
        }
        const why = verdict === "escalate" ? "The Encore Council escalated the plan" : "The Encore Council rejected the revised plan";
        await setGoalPlanStatus(deps.pool, { goalId, version: plan.version, status: "awaiting_approval", approvalRef: ref, note: `${why}:\n${objections}` });
        await deps.announce(goalId, `${why}. The operator decides on the board.\n${objections}`);
        return "awaiting_operator";
      }
    },
  };
}

export class PlanDecisionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanDecisionConflictError";
  }
}

/** The operator decides a plan the Encore Council escalated: approve it, or send it back to the Heads with a note. */
export function createPlanDecisionService(deps: {
  readonly pool: Pool;
  readonly assertOperator: (operatorId: string, projectId: string) => Promise<void>;
  /** Revise in the background, then run approval again. */
  readonly reviseLater: (input: { readonly goalId: string; readonly councilId: string; readonly objections: string }) => void;
}) {
  return {
    async decide(goalId: string, input: GoalPlanDecisionInput, operator: { readonly operatorId: string }): Promise<void> {
      await deps.assertOperator(operator.operatorId, input.projectId);
      const plan = await readGoalPlanVersion(deps.pool, goalId, input.projectId, input.version);
      if (plan.status !== "awaiting_approval") throw new PlanDecisionConflictError(`Plan v${plan.version} is ${plan.status}, not awaiting the operator`);
      if (input.decision === "approve") {
        await setGoalPlanStatus(deps.pool, { goalId, version: plan.version, status: "approved", approvalRef: `operator:${operator.operatorId}`, note: input.note ?? "Approved by the operator" });
        return;
      }
      await setGoalPlanStatus(deps.pool, { goalId, version: plan.version, status: "rejected", note: input.note! });
      deps.reviseLater({ goalId, councilId: plan.councilId!, objections: `Operator:\n${input.note!}` });
    },
  };
}
