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
const curatorOperatorId = randomUUID();

describeDatabase("organizational knowledge persistence", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  const schema = `knowledge_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = (() => { const url = new URL(databaseUrl); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })();
  let pool: Pool; let projectId: string; let otherProjectId: string; let otherGoalId: string; let goalId: string; let evidenceId: string; let evidenceId2: string;
  beforeAll(async () => { await basePool.query(`CREATE SCHEMA ${schema}`); pool = new Pool({ connectionString: scopedUrl }); await applyAllMigrations(pool); await bootstrapPermanentOrganization(pool); const migration0087 = readFileSync(fileURLToPath(new URL("../migrations/0087_organizational_knowledge.sql", import.meta.url)), "utf8"); await pool.query(migration0087); await pool.query(migration0087); });
  beforeEach(async () => {
    projectId = randomUUID(); otherProjectId = randomUUID(); goalId = randomUUID(); otherGoalId = randomUUID(); evidenceId = randomUUID(); evidenceId2 = randomUUID();
    await pool.query("INSERT INTO local_operators (operator_id) VALUES ($1), ($2) ON CONFLICT DO NOTHING", [operatorId, curatorOperatorId]);
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp()), ($3, $4, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId, otherGoalId, otherProjectId]);
    await pool.query("INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type) VALUES ($1, $2, $3, $4, $5, 'worker', $6, 10, 'lesson', 'text/plain')", [evidenceId, randomUUID(), randomUUID(), projectId, goalId, "a".repeat(64)]);
    await pool.query("INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type) VALUES ($1, $2, $3, $4, $5, 'worker', $6, 10, 'lesson', 'text/plain')", [evidenceId2, randomUUID(), randomUUID(), projectId, goalId, "b".repeat(64)]);
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectRole(pool, operatorId, projectId, "engineering");
    await grantProjectRole(pool, operatorId, projectId, "head-engineering");
    await grantProjectRole(pool, operatorId, projectId, "head-security");
    await grantProjectMembership(pool, curatorOperatorId, projectId);
    await grantProjectRole(pool, curatorOperatorId, projectId, "head-engineering");
    await grantProjectRole(pool, curatorOperatorId, projectId, "head-security");
    await grantProjectRole(pool, curatorOperatorId, projectId, "ceo");
  });
  afterAll(async () => { await pool.end(); await basePool.query(`DROP SCHEMA ${schema} CASCADE`); await basePool.end(); });

  const proposal = (overrides: Partial<OrganizationalKnowledgeProposalRecord> = {}): OrganizationalKnowledgeProposalRecord => ({
    schemaVersion: 1, projectId, sourceGoalId: goalId, departmentId: "engineering", statement: "Use a bounded validation gate.", rationale: "It prevented recurrence.", sourceEvidenceIds: [evidenceId, evidenceId2], sourceDigestIds: [], episodeIds: ["episode-a"], confidence: 0.9, freshness: 1, generalized: false, ...overrides,
  });

  it("keeps maintenance functions and marker tables closed to PUBLIC", async () => {
    const privileges = await pool.query<{ propagate_execute: boolean; old_propagate_absent: boolean; promotion_insert: boolean; source_insert: boolean; digest_loss_insert: boolean; digest_loss_execute: boolean; knowledge_retention: boolean; event_retention: boolean; auth_retention: boolean }>(`SELECT has_function_privilege('public', 'propagate_organizational_knowledge_evidence_loss(uuid,text,text,text)', 'EXECUTE') AS propagate_execute, to_regprocedure('propagate_organizational_knowledge_evidence_loss(uuid,text,text)') IS NULL AS old_propagate_absent, has_table_privilege('public', 'knowledge_promotion_authorizations', 'INSERT') AS promotion_insert, has_table_privilege('public', 'source_evidence_loss_authorizations', 'INSERT') AS source_insert, has_table_privilege('public', 'organizational_knowledge_digest_losses', 'INSERT') AS digest_loss_insert, has_function_privilege('public', 'authorize_knowledge_digest_loss(text,uuid,uuid,uuid,text,bigint,text,uuid,text)', 'EXECUTE') AS digest_loss_execute, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizational_knowledge' AND column_name = 'retention') AS knowledge_retention, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'source_evidence_loss_events' AND column_name = 'retention') AS event_retention, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'source_evidence_loss_authorizations' AND column_name = 'retention') AS auth_retention`);
    expect(privileges.rows[0]).toEqual({ propagate_execute: false, old_propagate_absent: true, promotion_insert: false, source_insert: false, digest_loss_insert: false, digest_loss_execute: false, knowledge_retention: true, event_retention: true, auth_retention: true });
    const cleanup = await pool.query<{ insert_allowed: boolean; maintenance_insert_allowed: boolean }>("SELECT has_table_privilege('public', 'organizational_knowledge_schema_cleanup_authorizations', 'INSERT') AS insert_allowed, has_table_privilege('public', 'knowledge_maintenance_authorizations', 'INSERT') AS maintenance_insert_allowed");
    expect(cleanup.rows[0]).toEqual({ insert_allowed: false, maintenance_insert_allowed: false });
  });

  it("requires canonical operation payload hashes at the database promotion boundary", async () => {
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "promotion-boundary-worker", leaseDurationMs: 60_000 });
    const insertDirectPromotion = async (operationPayloadHash: string | null, idempotencyKey: string): Promise<unknown> => {
      const proposed = await proposeOrganizationalKnowledge(pool, proposal(), proof, { actorId: proof.ownerId, sessionRef: `session:${idempotencyKey}`, operatorId, operatorRoleId: "head-engineering" }, `proposal-${idempotencyKey}`);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (operationPayloadHash !== null) await client.query("SELECT set_config('maestro.knowledge_promotion_payload_hash', $1, true)", [operationPayloadHash]);
        await client.query("SELECT authorize_knowledge_promotion($1, $2::uuid, $3, $4, $5, $6, $7::uuid, $8::uuid, $9::uuid, $10, $11::bigint, $12::uuid, $13)", [randomUUID(), proposed.knowledgeId, 2, "project_department", "head-engineering", "engineering", curatorOperatorId, projectId, goalId, proof.ownerId, proof.fencingToken, null, null]);
        let error: unknown;
        try {
          await client.query(`INSERT INTO organizational_knowledge
            (knowledge_id, revision, schema_version, source_project_id, project_id, source_goal_id, department_id, scope, status, statement, rationale, source_evidence_ids, source_digest_ids, episode_ids, confidence, freshness, generalized, author_operator_id, author_role_id, operation_payload_hash, promotion_operator_id, promotion_role_id, promotion_marker, reason, created_by, source_session_ref)
            VALUES ($1, 2, 1, $2, $2, $3, 'engineering', 'project_department', 'active', 'Use a bounded validation gate.', 'It prevented recurrence.', $4::jsonb, '[]', '["episode-a"]', 0.9, 1, false, $5::uuid, 'head-engineering', $6, $7::uuid, 'head-engineering', 'department-promotion', NULL, 'worker', $8)`, [proposed.knowledgeId, projectId, goalId, JSON.stringify([evidenceId, evidenceId2]), operatorId, operationPayloadHash, curatorOperatorId, `promotion:${idempotencyKey}`]);
        } catch (caught) {
          error = caught;
        }
        expect(error).toBeDefined();
        expect(String((error as { message?: string }).message ?? error)).toMatch(/payload|hash|authorization|promotion/i);
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
      return proposed;
    };

    await insertDirectPromotion(null, "null-hash");
    await insertDirectPromotion("f".repeat(64), "mismatched-hash");
    const formatted = await proposeOrganizationalKnowledge(pool, proposal(), proof, { actorId: proof.ownerId, sessionRef: "session:formatted", operatorId, operatorRoleId: "head-engineering" }, "proposal-formatted");
    const noncanonicalPayload = `{ "departmentId": "engineering", "knowledgeId": "${formatted.knowledgeId}",\n "promoterOperatorId": "${curatorOperatorId}", "promoterRoleId": "head-engineering" }`;
    const formattedClient = await pool.connect();
    try {
      await formattedClient.query("BEGIN");
      const rawHash = (await formattedClient.query<{ payload_hash: string }>("SELECT encode(public.digest($1, 'sha256'), 'hex') AS payload_hash", [noncanonicalPayload])).rows[0]!.payload_hash;
      await formattedClient.query("SELECT authorize_knowledge_promotion($1, $2::uuid, $3, $4, $5, $6, $7::uuid, $8::uuid, $9::uuid, $10, $11::bigint, $12::uuid, $13, $14::text)", [randomUUID(), formatted.knowledgeId, 2, "project_department", "head-engineering", "engineering", curatorOperatorId, projectId, goalId, proof.ownerId, proof.fencingToken, null, null, noncanonicalPayload]);
      await expect(formattedClient.query(`INSERT INTO organizational_knowledge
        (knowledge_id, revision, schema_version, source_project_id, project_id, source_goal_id, department_id, scope, status, statement, rationale, source_evidence_ids, source_digest_ids, episode_ids, confidence, freshness, generalized, author_operator_id, author_role_id, operation_payload_hash, promotion_operator_id, promotion_role_id, promotion_marker, reason, created_by, source_session_ref)
        VALUES ($1, 2, 1, $2, $2, $3, 'engineering', 'project_department', 'active', 'Use a bounded validation gate.', 'It prevented recurrence.', $4::jsonb, '[]', '["episode-a"]', 0.9, 1, false, $5::uuid, 'head-engineering', $6, $7::uuid, 'head-engineering', 'department-promotion', NULL, 'worker', 'promotion:formatted-json')`, [formatted.knowledgeId, projectId, goalId, JSON.stringify([evidenceId, evidenceId2]), operatorId, rawHash, curatorOperatorId])).rejects.toThrow(/authorization|canonical|payload|hash/);
      await formattedClient.query("ROLLBACK");
    } finally {
      formattedClient.release();
    }
  });

  it("binds digest-loss records and blocks direct truncation", async () => {
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "digest-loss-worker", leaseDurationMs: 60_000 });
    const digest = await recordImprovementDigest(pool, { schemaVersion: 1, projectId, goalId, episodeId: "digest-loss-episode", trigger: "goal_completed", situation: "A bounded task completed.", selectedDecision: "Keep the gate.", rejectedAlternatives: [], observedResult: "The gate held.", metrics: [], confidence: 0.8, sourceRefs: [{ kind: "goal", sourceId: goalId }] }, proof, { actorId: "worker", sessionRef: "session:digest-loss", operatorId });
    const client = await pool.connect();
    try {
      const forgedToken = "forged-digest-loss-token";
      await client.query("BEGIN");
      await expect(client.query(`INSERT INTO organizational_knowledge_digest_loss_authorizations (token_hash, digest_id, goal_id, project_id, owner_id, fencing_token, reason, recorded_by, role_id) VALUES (encode(public.digest($1, 'sha256'), 'hex'), $2, $3, $4, $5, $6, $7, $8, $9)`, [forgedToken, digest.digestId, goalId, projectId, proof.ownerId, proof.fencingToken, "forged", operatorId, "head-engineering"])).rejects.toThrow(/authorize|provenance|authorization/i);
      await client.query("ROLLBACK");
      await client.query("BEGIN");
      for (const [name, value] of [["maestro.knowledge_digest_loss_digest", digest.digestId], ["maestro.knowledge_digest_loss_goal", goalId], ["maestro.knowledge_digest_loss_project", projectId], ["maestro.knowledge_digest_loss_owner", proof.ownerId], ["maestro.knowledge_digest_loss_fence", String(proof.fencingToken)], ["maestro.knowledge_digest_loss_reason", "forged"], ["maestro.knowledge_digest_loss_recorded_by", operatorId], ["maestro.knowledge_digest_loss_role", "head-engineering"], ["maestro.knowledge_digest_loss_token", forgedToken]] as const) await client.query("SELECT set_config($1, $2, true)", [name, value]);
      await expect(client.query(`INSERT INTO organizational_knowledge_digest_losses (digest_id, goal_id, project_id, owner_id, fencing_token, reason, recorded_by, role_id, token_hash) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, encode(public.digest($9, 'sha256'), 'hex'))`, [digest.digestId, goalId, projectId, proof.ownerId, proof.fencingToken, "forged", operatorId, "head-engineering", forgedToken])).rejects.toThrow(/binding|authorization|loss/i);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("does not let a caller-controlled cleanup GUC authorize truncation", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('maestro.schema_cleanup_reset', '1', true)");
      await expect(client.query("TRUNCATE organizational_knowledge_digest_losses")).rejects.toThrow(/truncat|forbidden/i);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("persists worker proposals separately and only exposes promoted knowledge", async () => {
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "worker", leaseDurationMs: 60_000 });
    await expect(pool.query(`INSERT INTO organizational_knowledge (knowledge_id, revision, schema_version, source_project_id, project_id, source_goal_id, department_id, scope, status, statement, rationale, source_evidence_ids, source_digest_ids, episode_ids, confidence, freshness, generalized, council_round_id, generalized_statement, curator_role_id, promotion_marker, reason, created_by, source_session_ref) VALUES ($1, 1, 1, $2, $2, $3, 'engineering', 'worker_proposed', 'proposed', 'direct SQL', 'direct SQL', $4::jsonb, '[]', '["episode-a"]', 0.5, 1, false, NULL, NULL, NULL, 'worker-proposal', NULL, 'worker', 'sql:direct')`, [randomUUID(), projectId, goalId, JSON.stringify([evidenceId])])).rejects.toThrow(/authorization|marker/);
    const forgedKnowledgeId = randomUUID();
    await pool.query("SELECT authorize_knowledge_proposal($1, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7, $8::bigint, $9, $10, $11::jsonb)", [randomUUID(), forgedKnowledgeId, projectId, goalId, operatorId, "engineering", "worker", proof.fencingToken, "worker", "sql:wrong-payload", JSON.stringify({ statement: "wrong" })]);
    await expect(pool.query(`INSERT INTO organizational_knowledge (knowledge_id, revision, schema_version, source_project_id, project_id, source_goal_id, department_id, scope, status, statement, rationale, source_evidence_ids, source_digest_ids, episode_ids, confidence, freshness, generalized, promotion_marker, reason, created_by, source_session_ref) VALUES ($1, 1, 1, $2, $2, $3, 'engineering', 'worker_proposed', 'proposed', 'bound', 'bound', $4::jsonb, '[]', '["episode-a"]', 0.5, 1, false, 'worker-proposal', NULL, 'worker', 'sql:wrong-payload')`, [forgedKnowledgeId, projectId, goalId, JSON.stringify([evidenceId]),])).rejects.toThrow(/authorization|payload|marker/);
    await expect(proposeOrganizationalKnowledge(pool, proposal(), proof, { actorId: "other-worker", sessionRef: "session:other", operatorId, operatorRoleId: "head-engineering" }, "proposal-default")).rejects.toThrow(/author|owner/);
    const proposed = await proposeOrganizationalKnowledge(pool, proposal(), proof, { actorId: "worker", sessionRef: "session:worker", operatorId, operatorRoleId: "head-engineering" }, "proposal-default");
    expect(proposed.status).toBe("proposed");
    await expect(pool.query(`INSERT INTO organizational_knowledge
      (knowledge_id, revision, schema_version, source_project_id, project_id, source_goal_id, department_id, scope, status, statement, rationale, source_evidence_ids, source_digest_ids, episode_ids, confidence, freshness, generalized, council_round_id, generalized_statement, curator_role_id, promotion_marker, reason, created_by, source_session_ref)
      VALUES ($1, 2, 1, $2, $2, $3, 'engineering', 'project_department', 'active', 'raw lesson', 'raw rationale', $4::jsonb, '[]', '["episode-a"]', 0.5, 1, false, NULL, NULL, NULL, 'department-promotion', NULL, 'head-engineering', 'promotion:head-engineering')`, [proposed.knowledgeId, projectId, goalId, JSON.stringify([evidenceId, evidenceId2])])).rejects.toThrow();
    await expect(pool.query(`INSERT INTO organizational_knowledge
      (knowledge_id, revision, schema_version, source_project_id, project_id, source_goal_id, department_id, scope, status, statement, rationale, source_evidence_ids, source_digest_ids, episode_ids, confidence, freshness, generalized, council_round_id, generalized_statement, curator_role_id, curator_operator_id, curator_department_id, author_operator_id, author_role_id, promotion_marker, reason, created_by, source_session_ref)
      VALUES ($1, 2, 1, $2, $2, $3, 'engineering', 'project_department', 'unsupported', 'forged', 'forged', $4::jsonb, '[]', '["episode-a"]', 0.5, 1, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'adjudication', 'forged', 'head-engineering', 'forged-maintenance')`, [proposed.knowledgeId, projectId, goalId, JSON.stringify([evidenceId, evidenceId2])])).rejects.toThrow(/authorization|maintenance/);
    await pool.query("SELECT authorize_knowledge_maintenance($1, $2::uuid, $3, $4, $5::uuid, $6, $7, $8::bigint, $9, $10)", [randomUUID(), proposed.knowledgeId, 2, "unsupported", operatorId, "head-engineering", proof.ownerId, proof.fencingToken, "forged", "forged-maintenance"]);
    await expect(pool.query("INSERT INTO knowledge_maintenance_authorizations (token_hash, knowledge_id, revision, status, operator_id, role_id, owner_id, fencing_token, reason, source_session_ref) VALUES (encode(public.digest($1, 'sha256'), 'hex'), $2, $3, $4, $5, $6, $7, $8, $9, $10)", [randomUUID(), proposed.knowledgeId, 2, "unsupported", operatorId, "head-engineering", proof.ownerId, proof.fencingToken, "forged-direct", "forged-maintenance"])).rejects.toThrow(/secured|authorization|issuer/);
    await expect(pool.query(`INSERT INTO organizational_knowledge (knowledge_id, revision, schema_version, source_project_id, project_id, source_goal_id, department_id, scope, status, statement, rationale, source_evidence_ids, source_digest_ids, episode_ids, confidence, freshness, generalized, promotion_marker, reason, created_by, source_session_ref) VALUES ($1, 1, 1, $2, $2, $3, 'worker_proposed', 'project_department', 'unsupported', 'missing', 'missing', $4::jsonb, '[]', '["episode-a"]', 0.5, 1, false, 'source-loss', 'missing', 'worker', 'evidence:' || $5)`, [randomUUID(), projectId, goalId, JSON.stringify([randomUUID()]), evidenceId])).rejects.toThrow(/evidence|authorization|marker|source-loss/);
    const uppercaseDigestId = randomUUID().toUpperCase();
    await expect(pool.query(`INSERT INTO organizational_knowledge (knowledge_id, revision, schema_version, source_project_id, project_id, source_goal_id, department_id, scope, status, statement, rationale, source_evidence_ids, source_digest_ids, episode_ids, confidence, freshness, generalized, promotion_marker, reason, created_by, source_session_ref) VALUES ($1, 1, 1, $2, $2, $3, 'engineering', 'project_department', 'proposed', 'uppercase ref', 'uppercase ref', '[]', $4::jsonb, '["episode-a"]', 0.5, 1, false, 'worker-proposal', NULL, 'worker', 'sql:uppercase-ref')`, [randomUUID(), projectId, goalId, JSON.stringify([uppercaseDigestId])])).rejects.toThrow(/lowercase|canonical/);
    await expect(pool.query("TRUNCATE organizational_knowledge")).rejects.toThrow(/truncat|forbidden/);
    expect(await listOrganizationalKnowledge(pool, { operatorId, projectId, departmentId: "engineering", proof })).toEqual([]);
    const promoted = await promoteOrganizationalKnowledgeToProject(pool, { knowledgeId: proposed.knowledgeId, proof, promoterRoleId: "head-engineering", promoterOperatorId: curatorOperatorId, departmentId: "engineering", idempotencyKey: "project-default" });
    expect(promoted.scope).toBe("project_department");
    expect(promoted.operationPayloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(promoted.operationPayloadHash).not.toBe(proposed.operationPayloadHash);
    await expect(promoteOrganizationalKnowledgeToProject(pool, { knowledgeId: proposed.knowledgeId, proof, promoterRoleId: "head-engineering", promoterOperatorId: curatorOperatorId, departmentId: "engineering", idempotencyKey: "project-default" })).resolves.toEqual(promoted);
    await expect(pool.query("SELECT array_agg(retention::text ORDER BY revision)::text[] AS retention FROM organizational_knowledge WHERE knowledge_id = $1", [proposed.knowledgeId])).resolves.toMatchObject({ rows: [{ retention: ["project_lifetime", "project_lifetime"] }] });
    await expect(listOrganizationalKnowledge(pool, { operatorId, projectId, departmentId: "engineering", proof })).resolves.toMatchObject([{ knowledgeId: proposed.knowledgeId, projectId, departmentId: "engineering" }]);
  });

  it("replays proposal and promotion identities exactly and rejects changed payloads", async () => {
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "worker", leaseDurationMs: 60_000 });
    const first = await proposeOrganizationalKnowledge(pool, proposal(), proof, { actorId: "worker", sessionRef: "session:replay", operatorId, operatorRoleId: "head-engineering" }, "proposal-command");
    await expect(proposeOrganizationalKnowledge(pool, proposal(), proof, { actorId: "worker", sessionRef: "session:other", operatorId, operatorRoleId: "head-engineering" }, "proposal-command")).resolves.toEqual(first);
    await expect(proposeOrganizationalKnowledge(pool, proposal({ statement: "Changed payload." }), proof, { actorId: "worker", sessionRef: "session:other", operatorId, operatorRoleId: "head-engineering" }, "proposal-command")).rejects.toThrow(/conflicting|replay/);
    await expect(promoteOrganizationalKnowledgeToProject(pool, { knowledgeId: first.knowledgeId, proof, promoterRoleId: "head-engineering", promoterOperatorId: operatorId, departmentId: "engineering", idempotencyKey: "project-command" })).rejects.toThrow(/author|distinct/);
    await expect(proposeOrganizationalKnowledge(pool, proposal({ projectId: projectId.toUpperCase(), sourceGoalId: goalId.toUpperCase(), sourceEvidenceIds: [evidenceId.toUpperCase(), evidenceId2.toUpperCase()] }), proof, { actorId: "worker", sessionRef: "session:uppercase", operatorId, operatorRoleId: "head-engineering" }, "uppercase-proposal")).resolves.toMatchObject({ projectId, sourceProjectId: projectId, sourceGoalId: goalId });
    await expect(proposeOrganizationalKnowledge(pool, proposal(), proof, { actorId: "worker", sessionRef: "session:other", operatorId, operatorRoleId: "head-engineering" }, "")).rejects.toThrow(/idempotency/);
    const promoted = await promoteOrganizationalKnowledgeToProject(pool, { knowledgeId: first.knowledgeId, proof, promoterRoleId: "head-engineering", promoterOperatorId: curatorOperatorId, departmentId: "engineering", idempotencyKey: "project-command" });
    await expect(promoteOrganizationalKnowledgeToProject(pool, { knowledgeId: first.knowledgeId, proof, promoterRoleId: "head-engineering", promoterOperatorId: curatorOperatorId, departmentId: "engineering", idempotencyKey: "project-command" })).resolves.toEqual(promoted);
    await expect(promoteOrganizationalKnowledgeToProject(pool, { knowledgeId: first.knowledgeId, proof, promoterRoleId: "head-security", promoterOperatorId: curatorOperatorId, departmentId: "engineering", idempotencyKey: "project-command" })).rejects.toThrow(/conflicting|retry|Department Head identity/);
  });

  it("does not expose a project lesson in another project", async () => {
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "worker", leaseDurationMs: 60_000 });
    const proposed = await proposeOrganizationalKnowledge(pool, proposal(), proof, { actorId: "worker", sessionRef: "session:worker", operatorId, operatorRoleId: "head-engineering" }, "proposal-default");
    await promoteOrganizationalKnowledgeToProject(pool, { knowledgeId: proposed.knowledgeId, proof, promoterRoleId: "head-engineering", promoterOperatorId: curatorOperatorId, departmentId: "engineering", idempotencyKey: "project-default" });
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [randomUUID(), otherProjectId]);
    await grantProjectMembership(pool, operatorId, otherProjectId);
    await grantProjectRole(pool, operatorId, otherProjectId, "engineering");
    await expect(listOrganizationalKnowledge(pool, { operatorId, projectId: otherProjectId, departmentId: "engineering", proof })).rejects.toThrow(/project|Goal/);
    await grantProjectMembership(pool, operatorId, projectId);
    await expect(listOrganizationalKnowledge(pool, { operatorId, projectId, departmentId: "design", proof })).rejects.toThrow(/no active design role|role/);
  });

  it("requires Council approval and multiple episodes, then exposes global knowledge across projects", async () => {
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "worker", leaseDurationMs: 60_000 });
    const digestA = await recordImprovementDigest(pool, { schemaVersion: 1, projectId, goalId, episodeId: "episode-a", trigger: "goal_completed", situation: "A bounded task completed.", selectedDecision: "Keep the gate.", rejectedAlternatives: [], observedResult: "The gate held.", metrics: [], confidence: 0.8, sourceRefs: [{ kind: "goal", sourceId: goalId }] }, proof, { actorId: "worker", sessionRef: "session:worker", operatorId });
    const digestB = await recordImprovementDigest(pool, { schemaVersion: 1, projectId, goalId, episodeId: "episode-b", trigger: "goal_completed", situation: "A second bounded task completed.", selectedDecision: "Keep the gate.", rejectedAlternatives: [], observedResult: "The gate held again.", metrics: [], confidence: 0.8, sourceRefs: [{ kind: "goal", sourceId: goalId }] }, proof, { actorId: "worker", sessionRef: "session:worker", operatorId });
    const proposed = await proposeOrganizationalKnowledge(pool, proposal({ generalized: true, statement: "Use bounded validation gates." , sourceEvidenceIds: [], sourceDigestIds: [digestA.digestId, digestB.digestId], episodeIds: ["episode-a", "episode-b"] }), proof, { actorId: "worker", sessionRef: "session:worker", operatorId, operatorRoleId: "head-engineering" }, "proposal-default");
    await promoteOrganizationalKnowledgeToProject(pool, { knowledgeId: proposed.knowledgeId, proof, promoterRoleId: "head-engineering", promoterOperatorId: curatorOperatorId, departmentId: "engineering", idempotencyKey: "project-default" });
    await expect(promoteOrganizationalKnowledgeToGlobal(pool, { knowledgeId: proposed.knowledgeId, proof, promoterRoleId: "head-engineering", promoterOperatorId: curatorOperatorId, departmentId: "engineering", encoreCouncilRoundId: randomUUID(), corroboratingSourceIds: [digestA.digestId, digestB.digestId], corroboratingEpisodeIds: ["episode-a", "episode-b"], generalizedStatement: "Use bounded validation gates.", curatorRoleId: "head-security", curatorOperatorId: operatorId, idempotencyKey: "global-default" })).rejects.toThrow(/Council|approval/);
    await expect(promoteOrganizationalKnowledgeToGlobal(pool, { knowledgeId: proposed.knowledgeId, proof, promoterRoleId: "head-engineering", promoterOperatorId: curatorOperatorId, departmentId: "engineering", encoreCouncilRoundId: randomUUID(), corroboratingSourceIds: [digestA.digestId, digestB.digestId], corroboratingEpisodeIds: ["episode-a", "fabricated-episode"], generalizedStatement: "Use bounded validation gates.", curatorRoleId: "head-security", curatorOperatorId: operatorId, idempotencyKey: "global-default" })).rejects.toThrow(/episode|bound|source/);
    await expect(promoteOrganizationalKnowledgeToGlobal(pool, { knowledgeId: proposed.knowledgeId, proof, promoterRoleId: "head-engineering", promoterOperatorId: curatorOperatorId, departmentId: "engineering", encoreCouncilRoundId: randomUUID(), corroboratingSourceIds: [digestA.digestId, digestB.digestId], corroboratingEpisodeIds: ["episode-b", "episode-a"], generalizedStatement: "Use bounded validation gates.", curatorRoleId: "head-security", curatorOperatorId: operatorId, idempotencyKey: "global-default" })).rejects.toThrow(/episode|bound|source/);
    const wrongGoalId = randomUUID();
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [wrongGoalId, projectId]);
    const wrongRoundId = randomUUID();
    await pool.query("INSERT INTO encore_council_rounds (round_id, goal_id, question, criteria, evidence_ids, trigger_reasons, reviewer_count) VALUES ($1, $2, 'wrong goal', '[]', $3::jsonb, '[]', 2)", [wrongRoundId, wrongGoalId, JSON.stringify([digestA.digestId, digestB.digestId])]);
    await pool.query("INSERT INTO encore_council_syntheses (round_id, final_verdict, same_model_only, escalated, dissent_notes) VALUES ($1, 'proceed', true, false, '[]')", [wrongRoundId]);
    await expect(promoteOrganizationalKnowledgeToGlobal(pool, { knowledgeId: proposed.knowledgeId, proof, promoterRoleId: "head-engineering", promoterOperatorId: curatorOperatorId, departmentId: "engineering", encoreCouncilRoundId: wrongRoundId, corroboratingSourceIds: [digestA.digestId, digestB.digestId], corroboratingEpisodeIds: ["episode-a", "episode-b"], generalizedStatement: "Use bounded validation gates.", curatorRoleId: "head-security", curatorOperatorId: operatorId, idempotencyKey: "global-default" })).rejects.toThrow(/Council|approval|independent|Goal/);
    const sameModelRoundId = randomUUID();
    await pool.query("INSERT INTO encore_council_rounds (round_id, goal_id, question, criteria, evidence_ids, trigger_reasons, reviewer_count) VALUES ($1, $2, 'same model', '[]', $3::jsonb, '[]', 2)", [sameModelRoundId, goalId, JSON.stringify([digestA.digestId, digestB.digestId])]);
    for (const index of [0, 1]) await pool.query("INSERT INTO encore_council_judgments (judgment_id, round_id, reviewer_index, model_provider, model_id, verdict, confidence, reasoning, conditions, dissent_note, cited_evidence_ids, execution_ref, invocation_ref) VALUES ($1, $2, $3, 'provider', 'same-model', 'proceed', 'high', 'reviewed', '[]', NULL, $4::jsonb, $5, $6)", [randomUUID(), sameModelRoundId, index, JSON.stringify([digestA.digestId, digestB.digestId]), `execution:${index}`, `invocation:${index}`]);
    await pool.query("INSERT INTO encore_council_syntheses (round_id, final_verdict, same_model_only, escalated, dissent_notes) VALUES ($1, 'proceed', false, false, '[]')", [sameModelRoundId]);
    await expect(promoteOrganizationalKnowledgeToGlobal(pool, { knowledgeId: proposed.knowledgeId, proof, promoterRoleId: "head-engineering", promoterOperatorId: curatorOperatorId, departmentId: "engineering", encoreCouncilRoundId: sameModelRoundId, corroboratingSourceIds: [digestA.digestId, digestB.digestId], corroboratingEpisodeIds: ["episode-a", "episode-b"], generalizedStatement: "Use bounded validation gates.", curatorRoleId: "head-security", curatorOperatorId: operatorId, idempotencyKey: "global-default" })).rejects.toThrow(/Council|approval|independent/);
    const roundId = randomUUID();
    await pool.query("INSERT INTO encore_council_rounds (round_id, goal_id, question, criteria, evidence_ids, trigger_reasons, reviewer_count) VALUES ($1, $2, 'approve knowledge', '[]', $3::jsonb, '[]', 2)", [roundId, goalId, JSON.stringify([digestA.digestId, digestB.digestId])]);
    await pool.query("INSERT INTO encore_council_syntheses (round_id, final_verdict, same_model_only, escalated, dissent_notes) VALUES ($1, 'proceed', false, false, '[]')", [roundId]);
    for (const [index, provider, model] of [[0, "provider-a", "model-a"], [1, "provider-b", "model-b"]] as const) {
      const executionRef = `execution:valid:${index}`; const invocationRef = `invocation:valid:${index}`;
      await pool.query("INSERT INTO native_execution_bindings (binding_id, execution_ref, invocation_ref, goal_id, project_id, admission_kind, operator_id, mission_bundle_id, policy_version, idempotency_key, selected_model_provider, selected_model_id, actual_model_provider, actual_model_id) VALUES ($1, $2, $3, $4, $5, 'encore_reviewer', $6, 'knowledge', 'v1', $7, $8, $9, $8, $9)", [randomUUID(), executionRef, invocationRef, goalId, projectId, curatorOperatorId, `valid:${index}`, provider, model]);
      await pool.query("INSERT INTO encore_council_judgments (judgment_id, round_id, reviewer_index, model_provider, model_id, verdict, confidence, reasoning, conditions, dissent_note, cited_evidence_ids, execution_ref, invocation_ref) VALUES ($1, $2, $3, $4, $5, 'proceed', 'high', 'reviewed', '[]', NULL, $6::jsonb, $7, $8)", [randomUUID(), roundId, index, provider, model, JSON.stringify([digestA.digestId, digestB.digestId]), executionRef, invocationRef]);
    }
    await expect(promoteOrganizationalKnowledgeToGlobal(pool, { knowledgeId: proposed.knowledgeId, proof, promoterRoleId: "head-engineering", promoterOperatorId: curatorOperatorId, departmentId: "engineering", encoreCouncilRoundId: roundId, corroboratingSourceIds: [digestA.digestId, digestB.digestId], corroboratingEpisodeIds: ["episode-a", "episode-b"], generalizedStatement: "Use bounded validation gates.", curatorRoleId: "head-security", curatorOperatorId: curatorOperatorId, idempotencyKey: "global-default" })).rejects.toThrow(/independent/);
    await expect(promoteOrganizationalKnowledgeToGlobal(pool, { knowledgeId: proposed.knowledgeId, proof, promoterRoleId: "head-engineering", promoterOperatorId: curatorOperatorId, departmentId: "engineering", encoreCouncilRoundId: roundId, corroboratingSourceIds: [digestA.digestId, digestB.digestId], corroboratingEpisodeIds: ["episode-a", "episode-b"], generalizedStatement: "Use bounded validation gates.", curatorRoleId: "head-engineering", curatorOperatorId: curatorOperatorId, idempotencyKey: "global-default" })).rejects.toThrow(/independent/);
    const global = await promoteOrganizationalKnowledgeToGlobal(pool, { knowledgeId: proposed.knowledgeId, proof, promoterRoleId: "head-engineering", promoterOperatorId: curatorOperatorId, departmentId: "engineering", encoreCouncilRoundId: roundId, corroboratingSourceIds: [digestA.digestId, digestB.digestId], corroboratingEpisodeIds: ["episode-a", "episode-b"], generalizedStatement: "Use bounded validation gates.", curatorRoleId: "head-security", curatorOperatorId: operatorId, idempotencyKey: "global-default" });
    expect(global).toMatchObject({ scope: "global", statement: "Use bounded validation gates.", rationale: "Generalized organizational guidance." });
    const globalHash = (await pool.query<{ operation_payload_hash: string }>("SELECT operation_payload_hash FROM organizational_knowledge WHERE knowledge_id = $1 AND revision = 3", [proposed.knowledgeId])).rows[0]?.operation_payload_hash;
    expect(globalHash).toMatch(/^[0-9a-f]{64}$/);
    expect(globalHash).not.toBe(proposed.operationPayloadHash);
    expect(global).not.toHaveProperty("sourceProjectId");
    expect(global).not.toHaveProperty("sourceGoalId");
    expect(global).not.toHaveProperty("sourceEvidenceIds");
    const retry = await promoteOrganizationalKnowledgeToGlobal(pool, { knowledgeId: proposed.knowledgeId, proof, promoterRoleId: "head-engineering", promoterOperatorId: curatorOperatorId, departmentId: "engineering", encoreCouncilRoundId: roundId, corroboratingSourceIds: [digestA.digestId, digestB.digestId], corroboratingEpisodeIds: ["episode-a", "episode-b"], generalizedStatement: "Use bounded validation gates.", curatorRoleId: "head-security", curatorOperatorId: operatorId, idempotencyKey: "global-default" });
    expect(retry).toEqual(global);
    await grantProjectMembership(pool, operatorId, otherProjectId);
    await grantProjectRole(pool, operatorId, otherProjectId, "engineering");
    const otherProof = await acquireGoalLease(pool, { goalId: otherGoalId, ownerId: "worker", leaseDurationMs: 60_000 });
    const reusable = await listOrganizationalKnowledge(pool, { operatorId, projectId: otherProjectId, departmentId: "engineering", proof: otherProof });
    expect(reusable).toMatchObject([{ knowledgeId: proposed.knowledgeId, scope: "global", departmentId: "engineering" }]);
    expect(reusable[0]).not.toHaveProperty("sourceProjectId");
    expect(reusable[0]).not.toHaveProperty("sourceGoalId");
    expect(reusable[0]).not.toHaveProperty("sourceEvidenceIds");
    expect(reusable[0]).not.toHaveProperty("sourceSessionRef");
    expect(reusable[0]).not.toHaveProperty("createdBy");
  });

  it("persists stale and contradicted decay as auditable revisions", async () => {
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "worker", leaseDurationMs: 60_000 });
    const proposed = await proposeOrganizationalKnowledge(pool, proposal(), proof, { actorId: "worker", sessionRef: "session:worker", operatorId, operatorRoleId: "head-engineering" }, "proposal-default");
    const promoted = await promoteOrganizationalKnowledgeToProject(pool, { knowledgeId: proposed.knowledgeId, proof, promoterRoleId: "head-engineering", promoterOperatorId: curatorOperatorId, departmentId: "engineering", idempotencyKey: "project-default" });
    await expect(refreshOrganizationalKnowledge(pool, { knowledgeId: promoted.knowledgeId, now: "2026-09-20T00:00:00.000Z", lastSupportedAt: "2026-08-01T00:00:00.000Z", staleAfterMs: 86_400_000, proof, operatorId: randomUUID(), operatorRoleId: "head-engineering", idempotencyKey: "unauthorized" })).rejects.toThrow(/active|operator/);
    const stale = await refreshOrganizationalKnowledge(pool, { knowledgeId: promoted.knowledgeId, now: "2026-09-20T00:00:00.000Z", lastSupportedAt: "2026-08-01T00:00:00.000Z", staleAfterMs: 86_400_000, proof, operatorId, operatorRoleId: "head-engineering", idempotencyKey: "stale-refresh" });
    expect(stale.confidence).toBeLessThan(promoted.confidence);
    await expect(pool.query("SELECT source_session_ref FROM organizational_knowledge WHERE knowledge_id = $1 AND revision = $2", [promoted.knowledgeId, promoted.revision + 1])).resolves.toMatchObject({ rows: [{ source_session_ref: "system:knowledge-decay:stale-refresh" }] });
    await expect(refreshOrganizationalKnowledge(pool, { knowledgeId: promoted.knowledgeId, now: "2026-09-20T00:00:00.000Z", lastSupportedAt: "2026-08-01T00:00:00.000Z", staleAfterMs: 86_400_000, proof, operatorId, operatorRoleId: "head-engineering", idempotencyKey: "stale-refresh" })).resolves.toEqual(stale);
    const contradicted = await refreshOrganizationalKnowledge(pool, { knowledgeId: promoted.knowledgeId, now: "2026-09-21T00:00:00.000Z", lastSupportedAt: "2026-09-20T00:00:00.000Z", contradicted: true, proof, operatorId, operatorRoleId: "head-engineering", idempotencyKey: "contradiction-refresh" });
    expect(contradicted.status).toBe("contradicted");
    const visible = await listOrganizationalKnowledge(pool, { operatorId, projectId, departmentId: "engineering", proof });
    expect(visible.find((item) => item.knowledgeId === promoted.knowledgeId)).toMatchObject({ knowledgeId: promoted.knowledgeId, status: "contradicted" });
  });

  it("marks digest-sourced knowledge unsupported through the source-loss path", async () => {
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "worker", leaseDurationMs: 60_000 });
    const digest = await recordImprovementDigest(pool, { schemaVersion: 1, projectId, goalId, episodeId: "digest-episode", trigger: "goal_completed", situation: "A bounded task completed.", selectedDecision: "Keep the gate.", rejectedAlternatives: [], observedResult: "The gate held.", metrics: [], confidence: 0.8, sourceRefs: [{ kind: "goal", sourceId: goalId }] }, proof, { actorId: "worker", sessionRef: "session:worker", operatorId });
    const proposed = await proposeOrganizationalKnowledge(pool, proposal({ sourceEvidenceIds: [], sourceDigestIds: [digest.digestId] }), proof, { actorId: "worker", sessionRef: "session:worker", operatorId, operatorRoleId: "head-engineering" }, "proposal-default");
    await promoteOrganizationalKnowledgeToProject(pool, { knowledgeId: proposed.knowledgeId, proof, promoterRoleId: "head-engineering", promoterOperatorId: curatorOperatorId, departmentId: "engineering", idempotencyKey: "project-default" });
    const affected = await markKnowledgeUnsupportedForDigest(pool, digest.digestId.toUpperCase(), "digest provenance was withdrawn", proof, operatorId, "head-engineering");
    expect(affected).toContain(proposed.knowledgeId);
    const visible = await listOrganizationalKnowledge(pool, { operatorId, projectId, departmentId: "engineering", proof });
    expect(visible.find((item) => item.knowledgeId === proposed.knowledgeId)).toMatchObject({ knowledgeId: proposed.knowledgeId, status: "unsupported" });
    await expect(proposeOrganizationalKnowledge(pool, proposal({ sourceEvidenceIds: [], sourceDigestIds: [digest.digestId], episodeIds: ["digest-episode"] }), proof, { actorId: "worker", sessionRef: "session:post-loss", operatorId, operatorRoleId: "head-engineering" }, "post-loss-proposal")).rejects.toThrow(/withdrawn|loss|digest/);
  });

  it("marks source-evidence loss unsupported and retires without deleting provenance", async () => {
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "worker", leaseDurationMs: 60_000 });
    const proposed = await proposeOrganizationalKnowledge(pool, proposal(), proof, { actorId: "worker", sessionRef: "session:worker", operatorId, operatorRoleId: "head-engineering" }, "proposal-default");
    const promoted = await promoteOrganizationalKnowledgeToProject(pool, { knowledgeId: proposed.knowledgeId, proof, promoterRoleId: "head-engineering", promoterOperatorId: curatorOperatorId, departmentId: "engineering", idempotencyKey: "project-default" });
    await pool.query("SELECT set_config('maestro.source_evidence_loss', '1', true)");
    await expect(pool.query("DELETE FROM evidence_records WHERE evidence_id = $1", [evidenceId2])).rejects.toThrow(/immutable|authorization|invalid/);
    await expect(deleteEvidenceSource(pool, evidenceId, "source artifact was deleted", "worker", proof, "head-engineering")).rejects.toThrow(/operator|authorized/);
    await pool.query("UPDATE local_operators SET active = false WHERE operator_id = $1", [operatorId]);
    await expect(deleteEvidenceSource(pool, evidenceId, "source artifact was deleted", operatorId, proof, "head-engineering")).rejects.toThrow(/operator|authorized|active/);
    await pool.query("UPDATE local_operators SET active = true WHERE operator_id = $1", [operatorId]);
    await expect(deleteEvidenceSource(pool, evidenceId, "source artifact was deleted", operatorId, { ...proof, fencingToken: "999999" }, "head-engineering")).rejects.toThrow(/stale|lease/);
    await expect(pool.query("INSERT INTO source_evidence_loss_authorizations (token_hash, evidence_id, goal_id, project_id, owner_id, fencing_token, reason, recorded_by, role_id) VALUES (encode(public.digest($1, 'sha256'), 'hex'), $2, $3, $4, $5, $6, $7, $8, $9)", [randomUUID(), evidenceId, goalId, projectId, proof.ownerId, proof.fencingToken, "forged-direct", operatorId, "engineering"])).rejects.toThrow(/secured|authorization|issuer/);
    await deleteEvidenceSource(pool, evidenceId, "source artifact was deleted", operatorId, proof, "head-engineering");
    await expect(deleteEvidenceSource(pool, evidenceId, "different reason", operatorId, proof, "head-engineering")).rejects.toThrow(/conflicting/);
    await expect(deleteEvidenceSource(pool, evidenceId2, "password=should-not-persist", operatorId, proof, "head-engineering")).rejects.toThrow(/unsafe|secret|privacy|source/);
    await expect(deleteEvidenceSource(pool, evidenceId, "source artifact was deleted", operatorId, proof, "head-engineering")).resolves.toBeUndefined();
    await expect(pool.query("SELECT count(*)::int AS count FROM source_evidence_loss_events WHERE evidence_id = $1 AND goal_id = $2 AND project_id = $3 AND owner_id = $4 AND fencing_token = $5 AND reason = $6", [evidenceId, goalId, projectId, proof.ownerId, proof.fencingToken, "source artifact was deleted"])).resolves.toMatchObject({ rows: [{ count: 1 }] });
    await expect(pool.query("SELECT count(*)::int AS count FROM evidence_source_tombstones WHERE evidence_id = $1 AND goal_id = $2 AND project_id = $3", [evidenceId, goalId, projectId])).resolves.toMatchObject({ rows: [{ count: 1 }] });
    await expect(pool.query("INSERT INTO evidence_source_tombstones (evidence_id, goal_id, project_id, owner_id, fencing_token, reason, recorded_by) VALUES ($1, $2, $3, $4, $5, $6, $7)", [evidenceId2, goalId, projectId, proof.ownerId, proof.fencingToken, "forged", operatorId])).rejects.toThrow(/authorization|event|tombstone/);
    await expect(pool.query("UPDATE evidence_source_tombstones SET reason = 'forged' WHERE evidence_id = $1", [evidenceId])).rejects.toThrow(/immutable|tombstone/);
    await expect(pool.query("DELETE FROM evidence_source_tombstones WHERE evidence_id = $1", [evidenceId])).rejects.toThrow(/immutable|tombstone/);

    await expect(pool.query("SELECT count(*)::int AS count FROM evidence_records WHERE evidence_id = $1", [evidenceId])).resolves.toMatchObject({ rows: [{ count: 0 }] });
    const visible = await listOrganizationalKnowledge(pool, { operatorId, projectId, departmentId: "engineering", proof });
    expect(visible.find((item) => item.knowledgeId === proposed.knowledgeId)).toMatchObject({ knowledgeId: proposed.knowledgeId, status: "unsupported" });
    await expect(retireOrganizationalKnowledge(pool, { knowledgeId: proposed.knowledgeId, reason: "Superseded by reviewed guidance.", retiredBy: "worker", proof, operatorId, operatorRoleId: "head-engineering", idempotencyKey: "unauthorized" })).rejects.toThrow(/Department Head/);
    const retired = await retireOrganizationalKnowledge(pool, { knowledgeId: proposed.knowledgeId, reason: "Superseded by reviewed guidance.", retiredBy: "ceo", proof, operatorId: curatorOperatorId, operatorRoleId: "ceo", idempotencyKey: "retirement-command" });
    expect(retired).toMatchObject({ status: "retired", knowledgeId: promoted.knowledgeId });
    expect(retired.sourceEvidenceIds).toContain(evidenceId);
    await expect(retireOrganizationalKnowledge(pool, { knowledgeId: proposed.knowledgeId, reason: "retry", retiredBy: "ceo", proof, operatorId: curatorOperatorId, operatorRoleId: "ceo", idempotencyKey: "retirement-command" })).rejects.toThrow(/conflicting|retry/);
    await expect(retireOrganizationalKnowledge(pool, { knowledgeId: proposed.knowledgeId, reason: "Superseded by reviewed guidance.", retiredBy: "ceo", proof, operatorId: curatorOperatorId, operatorRoleId: "ceo", idempotencyKey: "retirement-command" })).resolves.toMatchObject({ status: "retired", knowledgeId: proposed.knowledgeId });
    await expect(pool.query("SELECT count(*)::int AS count FROM organizational_knowledge WHERE knowledge_id = $1", [proposed.knowledgeId])).resolves.toMatchObject({ rows: [{ count: expect.any(Number) }] });
    await expect(pool.query("UPDATE organizational_knowledge SET reason = 'tampered' WHERE knowledge_id = $1", [proposed.knowledgeId])).rejects.toThrow();
    await expect(pool.query("TRUNCATE goals CASCADE")).resolves.toBeDefined();
  });
});
