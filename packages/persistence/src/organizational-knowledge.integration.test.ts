import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./test-migrations.js";
import { grantProjectMembership, grantProjectRole } from "./project-membership.js";
import { bootstrapPermanentOrganization } from "./organization.js";
import { acquireGoalLease } from "./commands.js";
import { deleteEvidenceSource } from "./evidence.js";
import { recordImprovementDigest } from "./improvement-digest.js";
import {
  listOrganizationalKnowledge, markKnowledgeUnsupportedForDigest, promoteOrganizationalKnowledgeToGlobal, refreshOrganizationalKnowledge,
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
  let pool: Pool; let projectId: string; let otherProjectId: string; let goalId: string; let evidenceId: string; let evidenceId2: string;
  beforeAll(async () => { await basePool.query(`CREATE SCHEMA ${schema}`); pool = new Pool({ connectionString: scopedUrl }); await applyAllMigrations(pool); await bootstrapPermanentOrganization(pool); const migration0087 = readFileSync(fileURLToPath(new URL("../migrations/0087_organizational_knowledge.sql", import.meta.url)), "utf8"); await pool.query(migration0087); await pool.query(migration0087); });
  beforeEach(async () => {
    projectId = randomUUID(); otherProjectId = randomUUID(); goalId = randomUUID(); evidenceId = randomUUID(); evidenceId2 = randomUUID();
    await pool.query("INSERT INTO local_operators (operator_id) VALUES ($1) ON CONFLICT DO NOTHING", [operatorId]);
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version) VALUES ($1, $2, 'active', 1)", [goalId, projectId]);
    await pool.query("INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type) VALUES ($1, $2, $3, $4, $5, 'worker', $6, 10, 'lesson', 'text/plain')", [evidenceId, randomUUID(), randomUUID(), projectId, goalId, "a".repeat(64)]);
    await pool.query("INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type) VALUES ($1, $2, $3, $4, $5, 'worker', $6, 10, 'lesson', 'text/plain')", [evidenceId2, randomUUID(), randomUUID(), projectId, goalId, "b".repeat(64)]);
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectRole(pool, operatorId, projectId, "engineering");
    await grantProjectRole(pool, operatorId, projectId, "head-engineering");
    await grantProjectRole(pool, operatorId, projectId, "head-security");
  });
  afterAll(async () => { await pool.end(); await basePool.query(`DROP SCHEMA ${schema} CASCADE`); await basePool.end(); });

  const proposal = (overrides: Partial<OrganizationalKnowledgeProposalRecord> = {}): OrganizationalKnowledgeProposalRecord => ({
    schemaVersion: 1, projectId, sourceGoalId: goalId, departmentId: "engineering", statement: "Use a bounded validation gate.", rationale: "It prevented recurrence.", sourceEvidenceIds: [evidenceId, evidenceId2], sourceDigestIds: [], episodeIds: ["episode-a"], confidence: 0.9, freshness: 1, generalized: false, ...overrides,
  });

  it("persists worker proposals separately and only exposes promoted knowledge", async () => {
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "worker", leaseDurationMs: 60_000 });
    await expect(proposeOrganizationalKnowledge(pool, proposal(), proof, { actorId: "other-worker", sessionRef: "session:other" })).rejects.toThrow(/author|owner/);
    const proposed = await proposeOrganizationalKnowledge(pool, proposal(), proof, { actorId: "worker", sessionRef: "session:worker" });
    expect(proposed.status).toBe("proposed");
    await expect(pool.query(`INSERT INTO organizational_knowledge
      (knowledge_id, revision, schema_version, source_project_id, project_id, source_goal_id, department_id, scope, status, statement, rationale, source_evidence_ids, source_digest_ids, episode_ids, confidence, freshness, generalized, council_round_id, generalized_statement, curator_role_id, promotion_marker, reason, created_by, source_session_ref)
      VALUES ($1, 2, 1, $2, $2, $3, 'engineering', 'project_department', 'active', 'raw lesson', 'raw rationale', $4::jsonb, '[]', '["episode-a"]', 0.5, 1, false, NULL, NULL, NULL, 'department-promotion', NULL, 'head-engineering', 'promotion:head-engineering')`, [proposed.knowledgeId, projectId, goalId, JSON.stringify([evidenceId, evidenceId2])])).rejects.toThrow();
    expect(await listOrganizationalKnowledge(pool, { operatorId, projectId, departmentId: "engineering" })).toEqual([]);
    const promoted = await promoteOrganizationalKnowledgeToProject(pool, { knowledgeId: proposed.knowledgeId, promoterRoleId: "head-engineering", promoterOperatorId: operatorId, departmentId: "engineering" });
    expect(promoted.scope).toBe("project_department");
    await expect(listOrganizationalKnowledge(pool, { operatorId, projectId, departmentId: "engineering" })).resolves.toMatchObject([{ knowledgeId: proposed.knowledgeId, projectId, departmentId: "engineering" }]);
  });

  it("does not expose a project lesson in another project", async () => {
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "worker", leaseDurationMs: 60_000 });
    const proposed = await proposeOrganizationalKnowledge(pool, proposal(), proof, { actorId: "worker", sessionRef: "session:worker" });
    await promoteOrganizationalKnowledgeToProject(pool, { knowledgeId: proposed.knowledgeId, promoterRoleId: "head-engineering", promoterOperatorId: operatorId, departmentId: "engineering" });
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version) VALUES ($1, $2, 'active', 1)", [randomUUID(), otherProjectId]);
    await grantProjectMembership(pool, operatorId, otherProjectId);
    await grantProjectRole(pool, operatorId, otherProjectId, "engineering");
    await expect(listOrganizationalKnowledge(pool, { operatorId, projectId: otherProjectId, departmentId: "engineering" })).resolves.toEqual([]);
    await grantProjectMembership(pool, operatorId, projectId);
    await expect(listOrganizationalKnowledge(pool, { operatorId, projectId, departmentId: "design" })).rejects.toThrow(/no active design role|role/);
  });

  it("requires Council approval and multiple episodes, then exposes global knowledge across projects", async () => {
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "worker", leaseDurationMs: 60_000 });
    const digestA = await recordImprovementDigest(pool, { schemaVersion: 1, projectId, goalId, episodeId: "episode-a", trigger: "goal_completed", situation: "A bounded task completed.", selectedDecision: "Keep the gate.", rejectedAlternatives: [], observedResult: "The gate held.", metrics: [], confidence: 0.8, sourceRefs: [{ kind: "goal", sourceId: goalId }] }, proof, { actorId: "worker", sessionRef: "session:worker" });
    const digestB = await recordImprovementDigest(pool, { schemaVersion: 1, projectId, goalId, episodeId: "episode-b", trigger: "goal_completed", situation: "A second bounded task completed.", selectedDecision: "Keep the gate.", rejectedAlternatives: [], observedResult: "The gate held again.", metrics: [], confidence: 0.8, sourceRefs: [{ kind: "goal", sourceId: goalId }] }, proof, { actorId: "worker", sessionRef: "session:worker" });
    const proposed = await proposeOrganizationalKnowledge(pool, proposal({ generalized: true, statement: "Use bounded validation gates." , sourceEvidenceIds: [], sourceDigestIds: [digestA.digestId, digestB.digestId], episodeIds: ["episode-a", "episode-b"] }), proof, { actorId: "worker", sessionRef: "session:worker" });
    await promoteOrganizationalKnowledgeToProject(pool, { knowledgeId: proposed.knowledgeId, promoterRoleId: "head-engineering", promoterOperatorId: operatorId, departmentId: "engineering" });
    await expect(promoteOrganizationalKnowledgeToGlobal(pool, { knowledgeId: proposed.knowledgeId, promoterRoleId: "head-engineering", promoterOperatorId: operatorId, departmentId: "engineering", encoreCouncilRoundId: randomUUID(), corroboratingSourceIds: [digestA.digestId, digestB.digestId], corroboratingEpisodeIds: ["episode-a", "episode-b"], generalizedStatement: "Use bounded validation gates.", curatorRoleId: "head-security" })).rejects.toThrow(/Council|approval/);
    await expect(promoteOrganizationalKnowledgeToGlobal(pool, { knowledgeId: proposed.knowledgeId, promoterRoleId: "head-engineering", promoterOperatorId: operatorId, departmentId: "engineering", encoreCouncilRoundId: randomUUID(), corroboratingSourceIds: [digestA.digestId, digestB.digestId], corroboratingEpisodeIds: ["episode-a", "fabricated-episode"], generalizedStatement: "Use bounded validation gates.", curatorRoleId: "head-security" })).rejects.toThrow(/episode|bound|source/);
    await expect(promoteOrganizationalKnowledgeToGlobal(pool, { knowledgeId: proposed.knowledgeId, promoterRoleId: "head-engineering", promoterOperatorId: operatorId, departmentId: "engineering", encoreCouncilRoundId: randomUUID(), corroboratingSourceIds: [digestA.digestId, digestB.digestId], corroboratingEpisodeIds: ["episode-b", "episode-a"], generalizedStatement: "Use bounded validation gates.", curatorRoleId: "head-security" })).rejects.toThrow(/episode|bound|source/);
    const wrongGoalId = randomUUID();
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version) VALUES ($1, $2, 'active', 1)", [wrongGoalId, projectId]);
    const wrongRoundId = randomUUID();
    await pool.query("INSERT INTO encore_council_rounds (round_id, goal_id, question, criteria, evidence_ids, trigger_reasons, reviewer_count) VALUES ($1, $2, 'wrong goal', '[]', $3::jsonb, '[]', 2)", [wrongRoundId, wrongGoalId, JSON.stringify([digestA.digestId, digestB.digestId])]);
    await pool.query("INSERT INTO encore_council_syntheses (round_id, final_verdict, same_model_only, escalated, dissent_notes) VALUES ($1, 'proceed', true, false, '[]')", [wrongRoundId]);
    await expect(promoteOrganizationalKnowledgeToGlobal(pool, { knowledgeId: proposed.knowledgeId, promoterRoleId: "head-engineering", promoterOperatorId: operatorId, departmentId: "engineering", encoreCouncilRoundId: wrongRoundId, corroboratingSourceIds: [digestA.digestId, digestB.digestId], corroboratingEpisodeIds: ["episode-a", "episode-b"], generalizedStatement: "Use bounded validation gates.", curatorRoleId: "head-security" })).rejects.toThrow(/Council|approval|independent|Goal/);
    const sameModelRoundId = randomUUID();
    await pool.query("INSERT INTO encore_council_rounds (round_id, goal_id, question, criteria, evidence_ids, trigger_reasons, reviewer_count) VALUES ($1, $2, 'same model', '[]', $3::jsonb, '[]', 2)", [sameModelRoundId, goalId, JSON.stringify([digestA.digestId, digestB.digestId])]);
    for (const index of [0, 1]) await pool.query("INSERT INTO encore_council_judgments (judgment_id, round_id, reviewer_index, model_provider, model_id, verdict, confidence, reasoning, conditions, dissent_note, cited_evidence_ids, execution_ref, invocation_ref) VALUES ($1, $2, $3, 'provider', 'same-model', 'proceed', 'high', 'reviewed', '[]', NULL, $4::jsonb, $5, $6)", [randomUUID(), sameModelRoundId, index, JSON.stringify([digestA.digestId, digestB.digestId]), `execution:${index}`, `invocation:${index}`]);
    await pool.query("INSERT INTO encore_council_syntheses (round_id, final_verdict, same_model_only, escalated, dissent_notes) VALUES ($1, 'proceed', false, false, '[]')", [sameModelRoundId]);
    await expect(promoteOrganizationalKnowledgeToGlobal(pool, { knowledgeId: proposed.knowledgeId, promoterRoleId: "head-engineering", promoterOperatorId: operatorId, departmentId: "engineering", encoreCouncilRoundId: sameModelRoundId, corroboratingSourceIds: [digestA.digestId, digestB.digestId], corroboratingEpisodeIds: ["episode-a", "episode-b"], generalizedStatement: "Use bounded validation gates.", curatorRoleId: "head-security" })).rejects.toThrow(/Council|approval|independent/);
    const roundId = randomUUID();
    await pool.query("INSERT INTO encore_council_rounds (round_id, goal_id, question, criteria, evidence_ids, trigger_reasons, reviewer_count) VALUES ($1, $2, 'approve knowledge', '[]', $3::jsonb, '[]', 2)", [roundId, goalId, JSON.stringify([digestA.digestId, digestB.digestId])]);
    await pool.query("INSERT INTO encore_council_syntheses (round_id, final_verdict, same_model_only, escalated, dissent_notes) VALUES ($1, 'proceed', false, false, '[]')", [roundId]);
    for (const [index, provider, model] of [[0, "provider-a", "model-a"], [1, "provider-b", "model-b"]] as const) {
      const executionRef = `execution:valid:${index}`; const invocationRef = `invocation:valid:${index}`;
      await pool.query("INSERT INTO native_execution_bindings (binding_id, execution_ref, invocation_ref, goal_id, project_id, admission_kind, operator_id, mission_bundle_id, policy_version, idempotency_key, selected_model_provider, selected_model_id, actual_model_provider, actual_model_id) VALUES ($1, $2, $3, $4, $5, 'encore_reviewer', $6, 'knowledge', 'v1', $7, $8, $9, $8, $9)", [randomUUID(), executionRef, invocationRef, goalId, projectId, operatorId, `valid:${index}`, provider, model]);
      await pool.query("INSERT INTO encore_council_judgments (judgment_id, round_id, reviewer_index, model_provider, model_id, verdict, confidence, reasoning, conditions, dissent_note, cited_evidence_ids, execution_ref, invocation_ref) VALUES ($1, $2, $3, $4, $5, 'proceed', 'high', 'reviewed', '[]', NULL, $6::jsonb, $7, $8)", [randomUUID(), roundId, index, provider, model, JSON.stringify([digestA.digestId, digestB.digestId]), executionRef, invocationRef]);
    }
    const global = await promoteOrganizationalKnowledgeToGlobal(pool, { knowledgeId: proposed.knowledgeId, promoterRoleId: "head-engineering", promoterOperatorId: operatorId, departmentId: "engineering", encoreCouncilRoundId: roundId, corroboratingSourceIds: [digestA.digestId, digestB.digestId], corroboratingEpisodeIds: ["episode-a", "episode-b"], generalizedStatement: "Use bounded validation gates.", curatorRoleId: "head-security" });
    expect(global).toMatchObject({ scope: "global", statement: "Use bounded validation gates.", rationale: "Generalized organizational guidance." });
    expect(global).not.toHaveProperty("sourceProjectId");
    expect(global).not.toHaveProperty("sourceGoalId");
    expect(global).not.toHaveProperty("sourceEvidenceIds");
    await grantProjectMembership(pool, operatorId, otherProjectId);
    const reusable = await listOrganizationalKnowledge(pool, { operatorId, projectId: otherProjectId, departmentId: "engineering" });
    expect(reusable).toMatchObject([{ knowledgeId: proposed.knowledgeId, scope: "global", departmentId: "engineering" }]);
    expect(reusable[0]).not.toHaveProperty("sourceProjectId");
    expect(reusable[0]).not.toHaveProperty("sourceGoalId");
    expect(reusable[0]).not.toHaveProperty("sourceEvidenceIds");
    expect(reusable[0]).not.toHaveProperty("sourceSessionRef");
    expect(reusable[0]).not.toHaveProperty("createdBy");
  });

  it("persists stale and contradicted decay as auditable revisions", async () => {
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "worker", leaseDurationMs: 60_000 });
    const proposed = await proposeOrganizationalKnowledge(pool, proposal(), proof, { actorId: "worker", sessionRef: "session:worker" });
    const promoted = await promoteOrganizationalKnowledgeToProject(pool, { knowledgeId: proposed.knowledgeId, promoterRoleId: "head-engineering", promoterOperatorId: operatorId, departmentId: "engineering" });
    await expect(refreshOrganizationalKnowledge(pool, { knowledgeId: promoted.knowledgeId, now: "2026-09-20T00:00:00.000Z", lastSupportedAt: "2026-08-01T00:00:00.000Z", staleAfterMs: 86_400_000, proof, operatorId: randomUUID() })).rejects.toThrow(/active|operator/);
    const stale = await refreshOrganizationalKnowledge(pool, { knowledgeId: promoted.knowledgeId, now: "2026-09-20T00:00:00.000Z", lastSupportedAt: "2026-08-01T00:00:00.000Z", staleAfterMs: 86_400_000, proof, operatorId });
    expect(stale.confidence).toBeLessThan(promoted.confidence);
    const contradicted = await refreshOrganizationalKnowledge(pool, { knowledgeId: promoted.knowledgeId, now: "2026-09-21T00:00:00.000Z", lastSupportedAt: "2026-09-20T00:00:00.000Z", contradicted: true, proof, operatorId });
    expect(contradicted.status).toBe("contradicted");
    await expect(listOrganizationalKnowledge(pool, { operatorId, projectId, departmentId: "engineering" })).resolves.toMatchObject([{ knowledgeId: promoted.knowledgeId, status: "contradicted" }]);
  });

  it("marks digest-sourced knowledge unsupported through the source-loss path", async () => {
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "worker", leaseDurationMs: 60_000 });
    const digest = await recordImprovementDigest(pool, { schemaVersion: 1, projectId, goalId, episodeId: "digest-episode", trigger: "goal_completed", situation: "A bounded task completed.", selectedDecision: "Keep the gate.", rejectedAlternatives: [], observedResult: "The gate held.", metrics: [], confidence: 0.8, sourceRefs: [{ kind: "goal", sourceId: goalId }] }, proof, { actorId: "worker", sessionRef: "session:worker" });
    const proposed = await proposeOrganizationalKnowledge(pool, proposal({ sourceEvidenceIds: [], sourceDigestIds: [digest.digestId] }), proof, { actorId: "worker", sessionRef: "session:worker" });
    await promoteOrganizationalKnowledgeToProject(pool, { knowledgeId: proposed.knowledgeId, promoterRoleId: "head-engineering", promoterOperatorId: operatorId, departmentId: "engineering" });
    const affected = await markKnowledgeUnsupportedForDigest(pool, digest.digestId, "digest provenance was withdrawn", proof, operatorId);
    expect(affected).toContain(proposed.knowledgeId);
    await expect(listOrganizationalKnowledge(pool, { operatorId, projectId, departmentId: "engineering" })).resolves.toMatchObject([{ knowledgeId: proposed.knowledgeId, status: "unsupported" }]);
  });

  it("marks source-evidence loss unsupported and retires without deleting provenance", async () => {
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "worker", leaseDurationMs: 60_000 });
    const proposed = await proposeOrganizationalKnowledge(pool, proposal(), proof, { actorId: "worker", sessionRef: "session:worker" });
    const promoted = await promoteOrganizationalKnowledgeToProject(pool, { knowledgeId: proposed.knowledgeId, promoterRoleId: "head-engineering", promoterOperatorId: operatorId, departmentId: "engineering" });
    await pool.query("SELECT set_config('maestro.source_evidence_loss', '1', true)");
    await expect(pool.query("DELETE FROM evidence_records WHERE evidence_id = $1", [evidenceId2])).rejects.toThrow(/immutable|authorization|invalid/);
    await expect(deleteEvidenceSource(pool, evidenceId, "source artifact was deleted", "worker", proof)).rejects.toThrow(/operator|authorized/);
    await pool.query("UPDATE local_operators SET active = false WHERE operator_id = $1", [operatorId]);
    await expect(deleteEvidenceSource(pool, evidenceId, "source artifact was deleted", operatorId, proof)).rejects.toThrow(/operator|authorized|active/);
    await pool.query("UPDATE local_operators SET active = true WHERE operator_id = $1", [operatorId]);
    await expect(deleteEvidenceSource(pool, evidenceId, "source artifact was deleted", operatorId, { ...proof, fencingToken: "999999" })).rejects.toThrow(/stale|lease/);
    await deleteEvidenceSource(pool, evidenceId, "source artifact was deleted", operatorId, proof);
    await expect(pool.query("SELECT count(*)::int AS count FROM source_evidence_loss_events WHERE evidence_id = $1 AND goal_id = $2 AND project_id = $3 AND owner_id = $4 AND fencing_token = $5 AND reason = $6", [evidenceId, goalId, projectId, proof.ownerId, proof.fencingToken, "source artifact was deleted"])).resolves.toMatchObject({ rows: [{ count: 1 }] });
    await expect(pool.query("SELECT count(*)::int AS count FROM evidence_records WHERE evidence_id = $1", [evidenceId])).resolves.toMatchObject({ rows: [{ count: 0 }] });
    await expect(listOrganizationalKnowledge(pool, { operatorId, projectId, departmentId: "engineering" })).resolves.toMatchObject([{ knowledgeId: proposed.knowledgeId, status: "unsupported" }]);
    await expect(retireOrganizationalKnowledge(pool, { knowledgeId: proposed.knowledgeId, reason: "Superseded by reviewed guidance.", retiredBy: "worker", proof, operatorId })).rejects.toThrow(/Department Head/);
    await expect(retireOrganizationalKnowledge(pool, { knowledgeId: proposed.knowledgeId, reason: "Superseded by reviewed guidance.", retiredBy: "head-engineering", proof, operatorId })).resolves.toMatchObject({ status: "retired", knowledgeId: promoted.knowledgeId });
    await expect(retireOrganizationalKnowledge(pool, { knowledgeId: proposed.knowledgeId, reason: "retry", retiredBy: "head-engineering", proof, operatorId })).resolves.toMatchObject({ status: "retired", knowledgeId: proposed.knowledgeId });
    await expect(pool.query("SELECT count(*)::int AS count FROM organizational_knowledge WHERE knowledge_id = $1", [proposed.knowledgeId])).resolves.toMatchObject({ rows: [{ count: expect.any(Number) }] });
    await expect(pool.query("UPDATE organizational_knowledge SET reason = 'tampered' WHERE knowledge_id = $1", [proposed.knowledgeId])).rejects.toThrow();
  });
});
