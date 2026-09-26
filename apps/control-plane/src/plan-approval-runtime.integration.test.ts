import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EncoreCouncilResult } from "@maestro/contracts";
import { taskContractContentHash, type TaskContractSubstance } from "@maestro/domain";
import { acquireGoalLease, applyAllMigrations, bootstrapPermanentOrganization, createGoalPlanVersion, createHeadCouncil, readLatestGoalPlan } from "@maestro/persistence";
import { createPlanApprovalRuntime, createPlanDecisionService, PlanDecisionConflictError } from "./plan-approval-runtime.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const plan = (title: string) => ({
  phases: [{ phaseNo: 1, title: "Sign-up", outcome: "Visitors subscribe" }],
  slices: [{ sliceId: "p1s1", phaseNo: 1, departmentId: "engineering", title, objective: "Build", acceptance: ["Submits"], dependsOn: [] }],
});
const verdict = (finalVerdict: "proceed" | "do_not_proceed" | "escalate"): EncoreCouncilResult => ({
  roundId: randomUUID(),
  judgments: [{ modelProvider: "openai-codex", modelId: "gpt-5.6-luna", verdict: finalVerdict, confidence: "high", reasoning: `${finalVerdict} because`, conditions: finalVerdict === "proceed" ? [] : ["p1s1 needs rate limiting"], dissentNote: null, citedEvidenceIds: [] }],
  synthesis: { finalVerdict, sameModelOnly: true, escalated: finalVerdict === "escalate", dissentNotes: [] },
});

describeDatabase("Encore approval of the Heads' plan with PostgreSQL", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  const schema = `plan_approval_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = databaseUrl ? (() => { const url = new URL(databaseUrl); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })() : "";
  let pool: Pool;

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: scopedUrl });
    await applyAllMigrations(pool);
    await bootstrapPermanentOrganization(pool);
  });
  afterAll(async () => { await pool.end(); await basePool.query(`DROP SCHEMA ${schema} CASCADE`); await basePool.end(); });

  async function planned(departmentId: string) {
    const goalId = randomUUID(), contractId = randomUUID(), projectId = randomUUID();
    const content: TaskContractSubstance = {
      desiredOutcome: "A newsletter sign-up page", userVisibleBehavior: [], successCriteria: [], liveEvidence: [], scope: [], nonGoals: [], priorities: [], acceptableTradeoffs: [], constraints: [], knownEdgeCases: [],
      project: { projectId, repository: "repo", immutableBaseRevision: "base", dataBoundary: "local" },
      evidenceReferences: [], approvedPreviewReferences: [], expectedGroups: [], expectedDepartments: [], criticalActionExpectations: [], forbiddenEffects: [], environmentAssumptions: [], externalServiceAssumptions: [],
      budget: { ceiling: "1", reportingExpectations: [], stoppingConditions: [] },
    };
    await pool.query("INSERT INTO task_contracts (contract_id, schema_version, version, content, content_hash, launch_state) VALUES ($1, 1, 1, $2::jsonb, $3, 'launched')", [contractId, JSON.stringify(content), taskContractContentHash(content)]);
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, task_contract_id, created_at, updated_at) VALUES ($1, $2, 'active', 1, $3, now(), now())", [goalId, projectId, contractId]);
    await pool.query("INSERT INTO goal_head_participations (goal_id, department_id, head_role_id, contract_id, status, active_session_ref) VALUES ($1, $3, $4, $2, 'active', $5)", [goalId, contractId, departmentId, `head:${departmentId}`, `exec:${departmentId}`]);
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "test", leaseDurationMs: 60_000 });
    const council = await createHeadCouncil(pool, { goalId, contractId, briefDeadline: new Date(Date.now() + 60_000), evidence: {} }, proof, { actorId: "secretary", sessionRef: "secretary", commandId: randomUUID() });
    await createGoalPlanVersion(pool, { goalId, projectId, councilId: council.councilId, plan: plan("Form"), commandId: randomUUID() });
    return { goalId, projectId, councilId: council.councilId };
  }

  function runtime(verdicts: EncoreCouncilResult[], projectId: string) {
    const announced: string[] = [];
    const questions: string[] = [];
    const approval = createPlanApprovalRuntime({
      pool,
      review: async (_goalId, input) => { questions.push(input.question); return verdicts.shift()!; },
      revise: async ({ goalId, councilId, objections }) => {
        expect(objections).toContain("p1s1 needs rate limiting");
        return (await createGoalPlanVersion(pool, { goalId, projectId, councilId, plan: plan("Form with rate limit"), commandId: randomUUID() })).version;
      },
      announce: async (_goalId, content) => { announced.push(content); },
    });
    return { approval, announced, questions };
  }

  it("approves on a unanimous proceed and readies the slices", async () => {
    const { goalId, projectId, councilId } = await planned("engineering");
    const { approval, announced, questions } = runtime([verdict("proceed")], projectId);
    await expect(approval.run({ goalId, councilId })).resolves.toBe("approved");
    expect(questions[0]).toContain("A newsletter sign-up page");
    const stored = await readLatestGoalPlan(pool, goalId, projectId);
    expect(stored).toMatchObject({ status: "approved", decisionNote: "Approved by the Encore Council" });
    expect(stored.approvalRef).toMatch(/^encore:/);
    expect(stored.slices.map((slice) => slice.status)).toEqual(["approved"]);
    expect(announced).toEqual(["The Encore Council approved plan v1. Its slices are ready for dispatch."]);
    await expect(approval.run({ goalId, councilId })).resolves.toBe("approved");
  });

  it("revises once after a rejection, then waits for the operator, who decides", async () => {
    const { goalId, projectId, councilId } = await planned("design");
    const { approval, announced } = runtime([verdict("do_not_proceed"), verdict("escalate")], projectId);
    await expect(approval.run({ goalId, councilId })).resolves.toBe("awaiting_operator");
    const waiting = await readLatestGoalPlan(pool, goalId, projectId);
    expect(waiting).toMatchObject({ version: 2, status: "awaiting_approval" });
    expect(waiting.decisionNote).toContain("The Encore Council escalated the plan");
    expect(announced[0]).toContain("sent plan v1 back");
    await expect(approval.run({ goalId, councilId })).resolves.toBe("awaiting_operator");

    const revisions: string[] = [];
    const decisions = createPlanDecisionService({ pool, assertOperator: async () => undefined, reviseLater: ({ objections }) => revisions.push(objections) });
    await expect(decisions.decide(goalId, { projectId, version: 1, decision: "approve" }, { operatorId: "op" })).rejects.toBeInstanceOf(PlanDecisionConflictError);
    await decisions.decide(goalId, { projectId, version: 2, decision: "approve" }, { operatorId: "op" });
    const approved = await readLatestGoalPlan(pool, goalId, projectId);
    expect(approved).toMatchObject({ version: 2, status: "approved", approvalRef: "operator:op" });
    expect(revisions).toEqual([]);
  });

  it("sends an escalated plan back to the Heads with the operator's note", async () => {
    const { goalId, projectId, councilId } = await planned("security");
    const { approval } = runtime([verdict("escalate")], projectId);
    await expect(approval.run({ goalId, councilId })).resolves.toBe("awaiting_operator");
    const revisions: { councilId: string; objections: string }[] = [];
    const decisions = createPlanDecisionService({ pool, assertOperator: async () => undefined, reviseLater: (input) => revisions.push(input) });
    await decisions.decide(goalId, { projectId, version: 1, decision: "revise", note: "Merge p1s1 with the API work" }, { operatorId: "op" });
    expect(revisions).toEqual([{ goalId, councilId, objections: "Operator:\nMerge p1s1 with the API work" }]);
    expect((await pool.query("SELECT status, decision_note FROM goal_plans WHERE goal_id = $1", [goalId])).rows).toEqual([{ status: "rejected", decision_note: "Merge p1s1 with the API work" }]);
  });
});
