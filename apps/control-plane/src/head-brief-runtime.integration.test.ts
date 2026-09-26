import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { taskContractContentHash, type IndependentBrief, type TaskContractSubstance } from "@maestro/domain";
import { acquireGoalLease, applyAllMigrations, bootstrapPermanentOrganization, createHeadCouncil, listCouncilProtocolEvents, readHeadCouncil, readRevealedCouncilBriefs, type GoalLeaseProof } from "@maestro/persistence";
import { createHeadBriefRuntime, type HeadAsk } from "./head-brief-runtime.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const brief: IndependentBrief = {
  interpretation: "Build the sign-up form", contribution: "Own the form and API", nonGoals: [], assumptions: [], evidenceGaps: [], risks: [],
  dependencies: ["design: final mock"], proposedValidation: ["form submits"], expectedWorkers: ["frontend"], expectedCost: "small", expectedTime: "1 day", objectionsToLikelyAlternatives: [],
};

describeDatabase("Head brief runtime with PostgreSQL", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  const schema = `head_brief_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = databaseUrl ? (() => { const url = new URL(databaseUrl); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })() : "";
  let pool: Pool;

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: scopedUrl });
    await applyAllMigrations(pool);
    await bootstrapPermanentOrganization(pool);
  });
  afterAll(async () => { await pool.end(); await basePool.query(`DROP SCHEMA ${schema} CASCADE`); await basePool.end(); });

  async function council(departments: readonly string[]) {
    const goalId = randomUUID(), contractId = randomUUID(), projectId = randomUUID();
    const content: TaskContractSubstance = {
      desiredOutcome: "A newsletter sign-up page",
      userVisibleBehavior: [], successCriteria: [], liveEvidence: [], scope: [], nonGoals: [], priorities: [], acceptableTradeoffs: [], constraints: [], knownEdgeCases: [],
      project: { projectId, repository: "repo", immutableBaseRevision: "base", dataBoundary: "local" },
      evidenceReferences: [], approvedPreviewReferences: [], expectedGroups: [], expectedDepartments: [], criticalActionExpectations: [], forbiddenEffects: [], environmentAssumptions: [], externalServiceAssumptions: [],
      budget: { ceiling: "1", reportingExpectations: [], stoppingConditions: [] },
    };
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
    await pool.query("INSERT INTO task_contracts (contract_id, schema_version, version, content, content_hash, launch_state) VALUES ($1, 1, 1, $2::jsonb, $3, 'launched')", [contractId, JSON.stringify(content), taskContractContentHash(content)]);
    for (const departmentId of departments)
      await pool.query("INSERT INTO goal_head_participations (goal_id, department_id, head_role_id, contract_id, status, active_session_ref) VALUES ($1, $2, $3, $4, 'active', $5)", [goalId, departmentId, `head:${departmentId}`, contractId, `exec:${departmentId}`]);
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "test", leaseDurationMs: 60_000 });
    const created = await createHeadCouncil(pool, { goalId, contractId, briefDeadline: new Date(Date.now() + 60_000), evidence: {} }, proof, { actorId: "secretary", sessionRef: "secretary", commandId: randomUUID() });
    const withGoalLease = <T>(_goalId: string, operation: (lease: GoalLeaseProof) => Promise<T>) => operation(proof);
    return { goalId, councilId: created.councilId, withGoalLease };
  }

  it("collects briefs, lets unneeded Heads withdraw and sleep, and reveals once all settle", async () => {
    const { goalId, councilId, withGoalLease } = await council(["engineering", "design", "research"]);
    const prompts: Record<string, string> = {};
    let researchAttempts = 0;
    const ask: HeadAsk = async ({ departmentId, sessionRef, prompt }) => {
      prompts[departmentId] = prompt;
      expect(sessionRef).toBe(`exec:${departmentId}`);
      if (departmentId === "engineering") return `Here is my brief:\n${JSON.stringify({ needed: true, brief })}`;
      if (departmentId === "design") return JSON.stringify({ needed: false, reason: "The PRD reuses the existing blog theme; no design work." });
      researchAttempts += 1;
      if (researchAttempts === 1) return "I think we should research more.";
      return JSON.stringify({ needed: false, reason: "No open research questions." });
    };
    const posts: string[] = [];
    const post = async ({ goalId: postedGoal, departmentId, content }: { goalId: string; departmentId: string; content: string }) => {
      // A Head speaks while still awake.
      const status = await pool.query<{ status: string }>("SELECT status FROM goal_head_participations WHERE goal_id = $1 AND department_id = $2", [postedGoal, departmentId]);
      posts.push(`${departmentId}(${status.rows[0]!.status}): ${content}`);
    };
    const runtime = createHeadBriefRuntime({ pool, withGoalLease, ask, readPrd: async () => "# PRD\nNewsletter sign-up", post });

    const first = await runtime.run({ goalId, councilId });
    expect(first.revealed).toBe(false);
    expect(Object.fromEntries(first.outcomes.map((outcome) => [outcome.departmentId, outcome.outcome]))).toEqual({ design: "withdrew", engineering: "submitted", research: "failed" });
    expect(prompts.engineering).toContain("Engineering Department");
    expect(prompts.engineering).toContain("design, research");
    expect(prompts.engineering).toContain("Newsletter sign-up");
    const sleeping = await pool.query<{ department_id: string; status: string }>("SELECT department_id, status FROM goal_head_participations WHERE goal_id = $1 ORDER BY department_id", [goalId]);
    expect(sleeping.rows).toEqual([
      { department_id: "design", status: "sleeping" },
      { department_id: "engineering", status: "active" },
      { department_id: "research", status: "active" },
    ]);

    expect(posts.sort()).toEqual([
      "design(active): Not needed for this Goal: The PRD reuses the existing blog theme; no design work. Going back to sleep.",
      "engineering(active): Sealed brief submitted. It opens when every Head has settled.",
      "research(active): I could not write my brief yet: Head reply has no JSON object",
    ]);

    const second = await runtime.run({ goalId, councilId });
    expect(second.revealed).toBe(true);
    expect(second.outcomes.filter((outcome) => outcome.outcome !== "already_settled").map((outcome) => outcome.departmentId)).toEqual(["research"]);
    expect((await readHeadCouncil(pool, councilId)).state).toBe("revealed");
    expect((await readRevealedCouncilBriefs(pool, councilId)).map((entry) => entry.departmentId)).toEqual(["engineering"]);
    expect((await listCouncilProtocolEvents(pool, councilId)).filter((event) => event.eventType === "participant_withdrew")).toHaveLength(2);

    const third = await runtime.run({ goalId, councilId });
    expect(third).toEqual({ outcomes: [], revealed: true });
  });

  it("does not reveal when no Head is needed", async () => {
    const { goalId, councilId, withGoalLease } = await council(["research"]);
    const runtime = createHeadBriefRuntime({ pool, withGoalLease, ask: async () => JSON.stringify({ needed: false, reason: "Nothing to research." }) });
    expect(await runtime.run({ goalId, councilId })).toMatchObject({ revealed: false });
    expect((await readHeadCouncil(pool, councilId)).state).toBe("collecting");
  });
});
