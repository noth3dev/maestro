import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { taskContractContentHash, type IndependentBrief, type TaskContractSubstance } from "@maestro/domain";
import {
  acquireGoalLease,
  answerOvertureClarification,
  applyAllMigrations,
  bootstrapPermanentOrganization,
  createHeadCouncil,
  listOvertureClarifications,
  readLatestGoalPlan,
  type GoalLeaseProof,
} from "@maestro/persistence";
import { createHeadBriefRuntime } from "./head-brief-runtime.js";
import { createHeadMeetingRuntime, type MeetingChannel } from "./head-meeting-runtime.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const brief: IndependentBrief = {
  interpretation: "Build it", contribution: "Own it", nonGoals: [], assumptions: [], evidenceGaps: [], risks: [],
  dependencies: [], proposedValidation: ["works"], expectedWorkers: ["dev"], expectedCost: "small", expectedTime: "1 day", objectionsToLikelyAlternatives: [],
};
const slice = (sliceId: string, departmentId: string, dependsOn: string[] = []) => ({ sliceId, phaseNo: 1, departmentId, title: sliceId, objective: "do it", acceptance: ["done"], dependsOn });
const plan = (slices: ReturnType<typeof slice>[]) => JSON.stringify({ phases: [{ phaseNo: 1, title: "Sign-up", outcome: "Visitors subscribe" }], slices });

describeDatabase("Heads' planning meeting with PostgreSQL", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  const schema = `head_meeting_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = databaseUrl ? (() => { const url = new URL(databaseUrl); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })() : "";
  let pool: Pool;

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: scopedUrl });
    await applyAllMigrations(pool);
    await bootstrapPermanentOrganization(pool);
  });
  afterAll(async () => { await pool.end(); await basePool.query(`DROP SCHEMA ${schema} CASCADE`); await basePool.end(); });

  /** A Goal launched from an Overture run, with revealed briefs from engineering and security. */
  async function revealedCouncil() {
    const goalId = randomUUID(), contractId = randomUUID(), projectId = randomUUID(), conversationId = randomUUID(), runId = randomUUID();
    const content: TaskContractSubstance = {
      desiredOutcome: "A newsletter sign-up page",
      userVisibleBehavior: [], successCriteria: [], liveEvidence: [], scope: [], nonGoals: [], priorities: [], acceptableTradeoffs: [], constraints: [], knownEdgeCases: [],
      project: { projectId, repository: "repo", immutableBaseRevision: "base", dataBoundary: "local" },
      evidenceReferences: [], approvedPreviewReferences: [], expectedGroups: [], expectedDepartments: [], criticalActionExpectations: [], forbiddenEffects: [], environmentAssumptions: [], externalServiceAssumptions: [],
      budget: { ceiling: "1", reportingExpectations: [], stoppingConditions: [] },
    };
    await pool.query("INSERT INTO task_contracts (contract_id, schema_version, version, content, content_hash, launch_state) VALUES ($1, 1, 1, $2::jsonb, $3, 'launched')", [contractId, JSON.stringify(content), taskContractContentHash(content)]);
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, task_contract_id, created_at, updated_at) VALUES ($1, $2, 'active', 1, $3, now(), now())", [goalId, projectId, contractId]);
    await pool.query("INSERT INTO conversations (conversation_id, operator_id, project_id, goal_id, model_provider, model_id, status, version, binding) VALUES ($1, 'operator-1', $2, NULL, 'openai-codex', 'gpt-5.6-luna', 'active', 1, '{}'::jsonb)", [conversationId, projectId]);
    await pool.query("INSERT INTO overture_runs (run_id, conversation_id, project_id, state, version, role_taxonomy_version, create_command_id, task_contract_id) VALUES ($1, $2, $3, 'launched', 1, 3, $4, $5)", [runId, conversationId, projectId, randomUUID(), contractId]);
    for (const departmentId of ["engineering", "security"])
      await pool.query("INSERT INTO goal_head_participations (goal_id, department_id, head_role_id, contract_id, status, active_session_ref) VALUES ($1, $2, $3, $4, 'active', $5)", [goalId, departmentId, `head:${departmentId}`, contractId, `exec:${departmentId}`]);
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "test", leaseDurationMs: 60_000 });
    const council = await createHeadCouncil(pool, { goalId, contractId, briefDeadline: new Date(Date.now() + 60_000), evidence: {} }, proof, { actorId: "secretary", sessionRef: "secretary", commandId: randomUUID() });
    const withGoalLease = <T>(_goalId: string, operation: (lease: GoalLeaseProof) => Promise<T>) => operation(proof);
    const briefs = await createHeadBriefRuntime({ pool, withGoalLease, ask: async () => JSON.stringify({ needed: true, brief }) }).run({ goalId, councilId: council.councilId });
    expect(briefs.revealed).toBe(true);
    return { goalId, councilId: council.councilId, run: { runId, projectId, conversationId } };
  }

  it("chairs a discussion, pauses for the operator, drafts, takes objections, and stores the plan", async () => {
    const { goalId, councilId, run } = await revealedCouncil();
    const posts: string[] = [];
    const channel: MeetingChannel = {
      read: async () => posts.map((line) => { const [speaker, ...rest] = line.split(": "); return { speaker: speaker!, content: rest.join(": ") }; }),
      post: async (_goal, author, content) => { posts.push(`${author.kind === "role" ? "chair" : author.id.replace(/^head[-:]/, "")}: ${content}`); },
    };
    let chairTurns = 0, planAttempts = 0;
    const leadPrompts: string[] = [];
    const askLead = async ({ prompt, runId }: { prompt: string; runId: string }) => {
      expect(runId).toBe(run.runId);
      leadPrompts.push(prompt);
      if (prompt.includes("Your turn as chair")) {
        chairTurns += 1;
        if (chairTurns === 1) return JSON.stringify({ say: "Welcome. engineering, how do we store emails?", next: ["engineering", "marketing"], done: false });
        if (chairTurns === 2) return JSON.stringify({ say: "One question for the operator.", next: [], done: false, askOperator: "Which email provider?" });
        return JSON.stringify({ say: "Agreed. Writing the plan.", next: [], done: true });
      }
      planAttempts += 1;
      if (planAttempts === 1) return plan([slice("p1s1", "design")]);
      if (planAttempts === 2) return plan([slice("p1s1", "engineering")]);
      return `Revised:\n${plan([slice("p1s1", "engineering"), slice("p1s2", "security", ["p1s1"])])}`;
    };
    const askHead = async ({ departmentId, prompt }: { departmentId: string; prompt: string }) => {
      if (prompt.includes("Draft plan:")) return departmentId === "security" ? JSON.stringify({ approve: false, objections: ["p1s1 needs rate limiting"] }) : JSON.stringify({ approve: true, objections: [] });
      return `${departmentId}: Postgres table, I own it.`;
    };
    const meeting = createHeadMeetingRuntime({ pool, askHead, askLead, channel, readPrd: async () => "# Newsletter — PRD" });

    await expect(meeting.run({ goalId, councilId })).resolves.toBe("waiting_for_operator");
    expect(posts).toEqual([
      "chair: Welcome. engineering, how do we store emails?",
      "engineering: engineering: Postgres table, I own it.",
      "chair: One question for the operator.",
      "chair: Asked the operator: Which email provider? The meeting resumes when they answer.",
    ]);
    await expect(meeting.run({ goalId, councilId })).resolves.toBe("waiting_for_operator");
    const [question] = await listOvertureClarifications(pool, run.runId);
    await answerOvertureClarification(pool, { clarificationId: question!.clarificationId, ...run, answer: "Use Buttondown", commandId: randomUUID() });

    await expect(meeting.run({ goalId, councilId })).resolves.toBe("planned");
    expect(leadPrompts.at(-4)).toContain("A: Use Buttondown");
    expect(leadPrompts.some((prompt) => prompt.includes("Your last plan was invalid: p1s1 is owned by design"))).toBe(true);
    expect(leadPrompts.at(-1)).toContain("security: p1s1 needs rate limiting");
    expect(posts.slice(-4)).toEqual([
      "chair: Draft plan: 1 phases, 1 slices. Each Head, review your slices.",
      "engineering: I approve the draft.",
      "security: Objections:\n- p1s1 needs rate limiting",
      "chair: Plan v1 is drafted: 1 phases, 2 slices, revised for 1 objection(s). It goes to the Encore Council for approval.",
    ]);
    const stored = await readLatestGoalPlan(pool, goalId, run.projectId);
    expect(stored).toMatchObject({ councilId, status: "draft" });
    expect(stored.slices.map((entry) => [entry.sliceId, entry.departmentId])).toEqual([["p1s1", "engineering"], ["p1s2", "security"]]);

    await expect(meeting.run({ goalId, councilId })).resolves.toBe("planned");
  });
});
