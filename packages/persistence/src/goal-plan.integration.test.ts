import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GoalPlanSubstance } from "@maestro/domain";
import { applyAllMigrations } from "./test-migrations.js";
import { createGoalPlanVersion, GoalPlanNotFoundError, readLatestGoalPlan, setGoalPlanSliceStatus } from "./goal-plan.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const plan: GoalPlanSubstance = {
  phases: [{ phaseNo: 1, title: "Sign-up page", outcome: "Visitors can subscribe" }],
  slices: [
    { sliceId: "p1s1", phaseNo: 1, departmentId: "design", title: "Mock", objective: "Final mock", acceptance: ["Approved mock"], dependsOn: [] },
    { sliceId: "p1s10", phaseNo: 1, departmentId: "engineering", title: "Form", objective: "Build form", acceptance: ["Form submits"], dependsOn: ["p1s1"] },
    { sliceId: "p1s2", phaseNo: 1, departmentId: "engineering", title: "API", objective: "Store emails", acceptance: ["Stored"], dependsOn: [] },
  ],
};

describeDatabase("Goal plans with PostgreSQL", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  const schema = `goal_plan_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = databaseUrl ? (() => { const url = new URL(databaseUrl); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })() : "";
  let pool: Pool;
  const projectId = randomUUID();
  const goalId = randomUUID();

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: scopedUrl });
    await applyAllMigrations(pool);
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
  });
  afterAll(async () => { await pool.end(); await basePool.query(`DROP SCHEMA ${schema} CASCADE`); await basePool.end(); });

  it("stores versions, supersedes drafts, orders slices naturally, and tracks slice status", async () => {
    await expect(readLatestGoalPlan(pool, goalId, projectId)).rejects.toThrow(GoalPlanNotFoundError);
    const commandId = randomUUID();
    const first = await createGoalPlanVersion(pool, { goalId, projectId, councilId: null, plan, commandId });
    expect(first).toMatchObject({ version: 1, status: "draft" });
    expect(first.slices.map((slice) => slice.sliceId)).toEqual(["p1s1", "p1s2", "p1s10"]);
    expect((await createGoalPlanVersion(pool, { goalId, projectId, councilId: null, plan, commandId })).version).toBe(1);

    const second = await createGoalPlanVersion(pool, { goalId, projectId, councilId: null, plan: { ...plan, slices: plan.slices.slice(0, 1) }, commandId: randomUUID() });
    expect(second.version).toBe(2);
    expect((await readLatestGoalPlan(pool, goalId, projectId)).version).toBe(2);
    const statuses = await pool.query<{ version: number; status: string }>("SELECT version, status FROM goal_plans WHERE goal_id = $1 ORDER BY version", [goalId]);
    expect(statuses.rows.map((row) => row.status)).toEqual(["superseded", "draft"]);

    await setGoalPlanSliceStatus(pool, { goalId, version: 2, sliceId: "p1s1", status: "in_progress" });
    expect((await readLatestGoalPlan(pool, goalId, projectId)).slices[0]).toMatchObject({ sliceId: "p1s1", status: "in_progress" });
    await expect(readLatestGoalPlan(pool, goalId, randomUUID())).rejects.toThrow(GoalPlanNotFoundError);
  });
});
