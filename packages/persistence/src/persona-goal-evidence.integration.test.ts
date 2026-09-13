import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./test-migrations.js";
import { bootstrapPermanentOrganization } from "./organization.js";
import { capturePersonaGoalEvidence, readPersonaGoalEvidence, type PersonaGoalEvidenceInput } from "./persona-goal-evidence.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
describeDatabase("persona Goal evidence persistence", () => {
  const basePool = new Pool({ connectionString: databaseUrl }); const schema = `persona_evidence_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = databaseUrl === undefined ? undefined : (() => { const url = new URL(databaseUrl); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })(); let pool: Pool;
  const goalId = randomUUID(); const projectId = randomUUID();
  beforeAll(async () => { await basePool.query(`CREATE SCHEMA ${schema}`); pool = new Pool({ connectionString: scopedUrl }); await applyAllMigrations(pool); await bootstrapPermanentOrganization(pool); });
  beforeEach(async () => { await pool.query("TRUNCATE persona_goal_evidence, goals CASCADE"); await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]); });
  afterAll(async () => { await pool.end(); await basePool.query(`DROP SCHEMA ${schema} CASCADE`); await basePool.end(); });
  const evidence = (): PersonaGoalEvidenceInput => ({
    projectId, goalId, roleId: "head-security", taskClass: "incident-triage", taskContractVersion: 3, activeProfileVersion: 2,
    missionOverlay: { caution: 0.02 }, modelRef: "openai/gpt-5", skills: ["security-review"], tools: ["git"], contextSizeTokens: 12000, budgetCents: 500,
    collaboratorSet: ["head-quality"], qualityFindings: ["one defect fixed"], securityFindings: [], safetyFindings: [], finalCertification: "passed",
    reworkCount: 1, retryCount: 0, planRevisionCount: 1, escapedDefectCount: 0, timeToFirstUsefulOutputMs: 1000, timeToCertifiedCompletionMs: 5000,
    tokenCost: 1200, monetaryCostCents: 42, usefulMessageCount: 5, unnecessaryMessageCount: 1, scopeViolationCount: 0, authorityDenialCount: 1,
    safePauseCount: 0, falsePositivePauseCount: 0, dissentQuality: "high", dissentChangedOutcome: true, userCorrections: ["keep evidence"], explicitFeedback: "clear",
    comparedProfileVersions: ["head-security:1"],
  });
  it("captures every post-Goal field against the real Goal and replays idempotently", async () => {
    const first = await capturePersonaGoalEvidence(pool, evidence()); const retry = await capturePersonaGoalEvidence(pool, evidence());
    expect(retry.evidenceId).toBe(first.evidenceId); await expect(readPersonaGoalEvidence(pool, first.evidenceId)).resolves.toMatchObject(evidence());
  });
  it("rejects a project/Goal mismatch and preserves append-only provenance", async () => {
    await expect(capturePersonaGoalEvidence(pool, { ...evidence(), projectId: randomUUID() })).rejects.toThrow(/project/);
    const first = await capturePersonaGoalEvidence(pool, evidence());
    await expect(pool.query("DELETE FROM persona_goal_evidence WHERE evidence_id = $1", [first.evidenceId])).rejects.toThrow(/append-only/);
  });
});
