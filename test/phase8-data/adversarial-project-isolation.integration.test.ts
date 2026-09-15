import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyAllMigrations } from "../../packages/persistence/src/test-migrations.js";
import { bootstrapPermanentOrganization } from "../../packages/persistence/src/organization.js";
import { bootstrapLocalOperator } from "../../packages/persistence/src/auth.js";
import { grantProjectMembership } from "../../packages/persistence/src/project-membership.js";
import { capturePersonaGoalEvidence, readPersonaGoalEvidence, type PersonaGoalEvidenceInput } from "../../packages/persistence/src/persona-goal-evidence.js";


const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("Plan 8 §S4 adversarial project isolation", () => {
  const schema = `phase8_s4_isolation_${randomUUID().replaceAll("-", "")}`;
  let basePool: Pool;
  let pool: Pool;
  let projectA: string;
  let projectB: string;
  let goalA: string;
  let goalB: string;
  let contractA: string;
  let evidenceA: string;
  let operatorA: string;
  let operatorB: string;

  beforeAll(async () => {
    const configuredDatabaseUrl = databaseUrl;
    if (configuredDatabaseUrl === undefined) throw new Error("MAESTRO_TEST_DATABASE_URL is required");
    basePool = new Pool({ connectionString: configuredDatabaseUrl });
    const url = new URL(configuredDatabaseUrl);
    url.searchParams.set("options", `-c search_path=${schema}`);
    pool = new Pool({ connectionString: url.toString() });
    await basePool.query(`CREATE SCHEMA ${schema}`);
    await applyAllMigrations(pool);
    await bootstrapPermanentOrganization(pool);
  });

  beforeEach(async () => {
    projectA = randomUUID(); projectB = randomUUID(); goalA = randomUUID(); goalB = randomUUID(); contractA = randomUUID();
    await pool.query("TRUNCATE persona_goal_evidence, goal_head_participations, head_councils, task_contracts, goals, local_operator_credentials, local_operators CASCADE");
    operatorA = (await bootstrapLocalOperator(pool, { secret: "s4-operator-a" })).operatorId;
    operatorB = (await bootstrapLocalOperator(pool, { secret: "s4-operator-b" })).operatorId;
    await grantProjectMembership(pool, operatorA, projectA);
    await grantProjectMembership(pool, operatorB, projectB);
    await pool.query(
      "INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'succeeded', 1, transaction_timestamp(), transaction_timestamp()), ($3, $4, 'succeeded', 1, transaction_timestamp(), transaction_timestamp())",
      [goalA, projectA, goalB, projectB],
    );
    await pool.query("INSERT INTO task_contracts (contract_id, schema_version, version, content, content_hash, launch_state) VALUES ($1, 1, 3, '{}'::jsonb, $2, 'launched')", [contractA, "a".repeat(64)]);
    await pool.query("INSERT INTO head_councils (council_id, goal_id, contract_id, brief_deadline, state, snapshot_hash, snapshot_payload) VALUES ($1, $2, $3, transaction_timestamp() + interval '1 hour', 'collecting', $4, '{}'::jsonb)", [randomUUID(), goalA, contractA, "b".repeat(64)]);
    await pool.query("INSERT INTO goal_head_participations (goal_id, department_id, head_role_id, contract_id, status, active_session_ref) VALUES ($1, 'security', 'head:security', $2, 'sleeping', NULL)", [goalA, contractA]);
    const profileAxes = { agreeableness: 0, extraversion: 0, imagination: 0, realism: 0, conscientiousness: 0, caution: 0, initiative: 0, empathy: 0, adaptability: 0, sociability: 0 };
    const profileRationale = Object.fromEntries(Object.keys(profileAxes).map((axis) => [axis, { reason: "S4 isolation fixture", low: "less", current: "balanced", high: "more" }]));
    await pool.query("INSERT INTO persona_profile_versions (role_id, version, profile, rationale, source) VALUES ('head-security', 1, $1::jsonb, $2::jsonb, 's4-isolation-fixture') ON CONFLICT (role_id, version) DO NOTHING", [JSON.stringify(profileAxes), JSON.stringify(profileRationale)]);
    const captured = await capturePersonaGoalEvidence(pool, {
      projectId: projectA, goalId: goalA, roleId: "head-security", taskClass: "incident-triage", taskContractVersion: 3, activeProfileVersion: 1,
      missionOverlay: { caution: 0.02 }, modelRef: "openai/gpt-5", skills: ["security-review"], tools: ["git"], contextSizeTokens: 12000, budgetCents: 500,
      collaboratorSet: ["head-quality"], qualityFindings: ["one defect fixed"], securityFindings: [], safetyFindings: [], finalCertification: "passed",
      reworkCount: 1, retryCount: 0, planRevisionCount: 1, escapedDefectCount: 0, timeToFirstUsefulOutputMs: 1000, timeToCertifiedCompletionMs: 5000,
      tokenCost: 1200, monetaryCostCents: 42, usefulMessageCount: 5, unnecessaryMessageCount: 1, scopeViolationCount: 0, authorityDenialCount: 1,
      safePauseCount: 0, falsePositivePauseCount: 0, dissentQuality: "high", dissentChangedOutcome: true, userCorrections: ["keep evidence"], explicitFeedback: "clear",
      comparedProfileVersions: ["head-security:1"],
    } satisfies PersonaGoalEvidenceInput);
    evidenceA = captured.evidenceId;
  });

  afterAll(async () => {
    await pool.end();
    await basePool.query(`DROP SCHEMA ${schema} CASCADE`);
    await basePool.end();
  });

  it("denies foreign project, Goal, and operator reads while preserving the bound read", async () => {
    await expect(readPersonaGoalEvidence(pool, evidenceA, { operatorId: operatorA, projectId: projectB, goalId: goalB })).rejects.toThrow(/not found|project|Goal|access/i);
    await expect(readPersonaGoalEvidence(pool, evidenceA, { operatorId: operatorA, projectId: projectB, goalId: goalA })).rejects.toThrow(/membership|access|not found|project/i);
    await expect(readPersonaGoalEvidence(pool, evidenceA, { operatorId: operatorA, projectId: projectA, goalId: goalB })).rejects.toThrow(/not found|project|Goal|access/i);
    await expect(readPersonaGoalEvidence(pool, evidenceA, { operatorId: operatorB, projectId: projectA, goalId: goalA })).rejects.toThrow(/membership|access|not found|project/i);
    await expect(readPersonaGoalEvidence(pool, evidenceA, { operatorId: operatorA, projectId: projectA, goalId: goalA })).resolves.toMatchObject({ evidenceId: evidenceA, projectId: projectA, goalId: goalA });
  });
});
