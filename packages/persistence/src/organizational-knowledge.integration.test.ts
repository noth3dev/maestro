import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./test-migrations.js";
import { grantProjectMembership } from "./project-membership.js";
import { acquireGoalLease } from "./commands.js";
import {
  listOrganizationalKnowledge, markKnowledgeUnsupportedForEvidence, promoteOrganizationalKnowledgeToGlobal,
  promoteOrganizationalKnowledgeToProject, proposeOrganizationalKnowledge, retireOrganizationalKnowledge,
  type OrganizationalKnowledgeProposalRecord,
} from "./organizational-knowledge.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL ?? "postgresql://127.0.0.1/maestro_test";
const describeDatabase = process.env.MAESTRO_TEST_DATABASE_URL ? describe : describe.skip;
const operatorId = randomUUID();

describeDatabase("organizational knowledge persistence", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  const schema = `knowledge_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = (() => { const url = new URL(databaseUrl); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })();
  let pool: Pool; let projectId: string; let otherProjectId: string; let goalId: string; let evidenceId: string;
  beforeAll(async () => { await basePool.query(`CREATE SCHEMA ${schema}`); pool = new Pool({ connectionString: scopedUrl }); await applyAllMigrations(pool); await applyAllMigrations(pool); });
  beforeEach(async () => {
    projectId = randomUUID(); otherProjectId = randomUUID(); goalId = randomUUID(); evidenceId = randomUUID();
    await pool.query("INSERT INTO local_operators (operator_id) VALUES ($1) ON CONFLICT DO NOTHING", [operatorId]);
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version) VALUES ($1, $2, 'active', 1)", [goalId, projectId]);
    await pool.query("INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type) VALUES ($1, $2, $3, $4, $5, 'worker', $6, 10, 'lesson', 'text/plain')", [evidenceId, randomUUID(), randomUUID(), projectId, goalId, "a".repeat(64)]);
    await grantProjectMembership(pool, operatorId, projectId);
  });
  afterAll(async () => { await pool.end(); await basePool.query(`DROP SCHEMA ${schema} CASCADE`); await basePool.end(); });

  const proposal = (overrides: Partial<OrganizationalKnowledgeProposalRecord> = {}): OrganizationalKnowledgeProposalRecord => ({
    schemaVersion: 1, projectId, sourceGoalId: goalId, departmentId: "engineering", statement: "Use a bounded validation gate.", rationale: "It prevented recurrence.", sourceEvidenceIds: [evidenceId], sourceDigestIds: [], episodeIds: ["episode-a"], confidence: 0.9, freshness: 1, generalized: false, ...overrides,
  });

  it("persists worker proposals separately and only exposes promoted knowledge", async () => {
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "worker", leaseDurationMs: 60_000 });
    const proposed = await proposeOrganizationalKnowledge(pool, proposal(), proof, { actorId: "worker", sessionRef: "session:worker" });
    expect(proposed.status).toBe("proposed");
    expect(await listOrganizationalKnowledge(pool, { operatorId, projectId })).toEqual([]);
    const promoted = await promoteOrganizationalKnowledgeToProject(pool, { knowledgeId: proposed.knowledgeId, promoterRoleId: "head-engineering", departmentId: "engineering" });
    expect(promoted.scope).toBe("project_department");
    await expect(listOrganizationalKnowledge(pool, { operatorId, projectId })).resolves.toMatchObject([{ knowledgeId: proposed.knowledgeId, projectId, departmentId: "engineering" }]);
  });

  it("does not expose a project lesson in another project", async () => {
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "worker", leaseDurationMs: 60_000 });
    const proposed = await proposeOrganizationalKnowledge(pool, proposal(), proof, { actorId: "worker", sessionRef: "session:worker" });
    await promoteOrganizationalKnowledgeToProject(pool, { knowledgeId: proposed.knowledgeId, promoterRoleId: "head-engineering", departmentId: "engineering" });
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version) VALUES ($1, $2, 'active', 1)", [randomUUID(), otherProjectId]);
    await grantProjectMembership(pool, operatorId, otherProjectId);
    await expect(listOrganizationalKnowledge(pool, { operatorId, projectId: otherProjectId })).resolves.toEqual([]);
  });

  it("requires Council approval and multiple episodes, then exposes global knowledge across projects", async () => {
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "worker", leaseDurationMs: 60_000 });
    const proposed = await proposeOrganizationalKnowledge(pool, proposal({ generalized: true, statement: "Use bounded validation gates." , episodeIds: ["episode-a", "episode-b"] }), proof, { actorId: "worker", sessionRef: "session:worker" });
    await expect(promoteOrganizationalKnowledgeToGlobal(pool, { knowledgeId: proposed.knowledgeId, promoterRoleId: "head-engineering", departmentId: "engineering", encoreCouncilRoundId: randomUUID() })).rejects.toThrow(/Council|approval/);
    const roundId = randomUUID();
    await pool.query("INSERT INTO encore_council_rounds (round_id, goal_id, question, criteria, evidence_ids, trigger_reasons, reviewer_count) VALUES ($1, $2, 'approve knowledge', '[]', '[]', '[]', 2)", [roundId, goalId]);
    await pool.query("INSERT INTO encore_council_syntheses (round_id, final_verdict, same_model_only, escalated, dissent_notes) VALUES ($1, 'proceed', false, false, '[]')", [roundId]);
    const global = await promoteOrganizationalKnowledgeToGlobal(pool, { knowledgeId: proposed.knowledgeId, promoterRoleId: "head-engineering", departmentId: "engineering", encoreCouncilRoundId: roundId });
    expect(global).toMatchObject({ scope: "global", projectId: null });
    await grantProjectMembership(pool, operatorId, otherProjectId);
    await expect(listOrganizationalKnowledge(pool, { operatorId, projectId: otherProjectId })).resolves.toMatchObject([{ knowledgeId: proposed.knowledgeId, scope: "global" }]);
  });

  it("marks source-evidence loss unsupported and retires without deleting provenance", async () => {
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "worker", leaseDurationMs: 60_000 });
    const proposed = await proposeOrganizationalKnowledge(pool, proposal(), proof, { actorId: "worker", sessionRef: "session:worker" });
    const promoted = await promoteOrganizationalKnowledgeToProject(pool, { knowledgeId: proposed.knowledgeId, promoterRoleId: "head-engineering", departmentId: "engineering" });
    const unsupported = await markKnowledgeUnsupportedForEvidence(pool, evidenceId, "source artifact was deleted");
    expect(unsupported).toContain(proposed.knowledgeId);
    await expect(retireOrganizationalKnowledge(pool, { knowledgeId: proposed.knowledgeId, reason: "Superseded by reviewed guidance.", retiredBy: "head-engineering" })).resolves.toMatchObject({ status: "retired", knowledgeId: promoted.knowledgeId });
    await expect(pool.query("SELECT count(*)::int AS count FROM organizational_knowledge WHERE knowledge_id = $1", [proposed.knowledgeId])).resolves.toMatchObject({ rows: [{ count: 3 }] });
  });
});
