import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { improvementDigestContentHash, type ImprovementDigestInput } from "@maestro/domain";
import { applyAllMigrations } from "./test-migrations.js";
import { acquireGoalLease } from "./commands.js";
import { listImprovementDigests, readImprovementDigest, recordImprovementDigest, type ImprovementDigestAuthor } from "./improvement-digest.js";
import { grantProjectMembership } from "./project-membership.js";
import { withGoalAuthority } from "./goal-authority.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL ?? "postgresql://127.0.0.1/maestro_test";
const describeDatabase = process.env.MAESTRO_TEST_DATABASE_URL ? describe : describe.skip;
const author: ImprovementDigestAuthor = { actorId: "encore-curator", sessionRef: "session:encore:1" };
const readerOperatorId = randomUUID();
const reader = (projectId: string) => ({ operatorId: readerOperatorId, projectId });
const inputFor = (goalId: string, projectId: string, overrides: Partial<ImprovementDigestInput> = {}): ImprovementDigestInput => ({
  schemaVersion: 1, projectId, goalId, episodeId: "episode-1", trigger: "goal_completed",
  situation: "The bounded task completed after one review correction.", selectedDecision: "Keep the deterministic validation gate.",
  rejectedAlternatives: ["Skip the validation gate."], observedResult: "The certified result retained the required safety checks.",
  metrics: [{ name: "rework_count", value: 1, unit: "count" }], confidence: 0.9, sourceRefs: [{ kind: "goal", sourceId: goalId }], ...overrides,
});

describeDatabase("Improvement Digest persistence", () => {
  const basePool = new Pool({ connectionString: databaseUrl }); const schema = `digest_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = (() => { const url = new URL(databaseUrl!); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })();
  let pool: Pool; let goalId: string; let projectId: string;
  beforeAll(async () => { await basePool.query(`CREATE SCHEMA ${schema}`); pool = new Pool({ connectionString: scopedUrl }); await applyAllMigrations(pool); await applyAllMigrations(pool); });
  beforeEach(async () => { goalId = randomUUID(); projectId = randomUUID(); await pool.query("INSERT INTO local_operators (operator_id) VALUES ($1) ON CONFLICT DO NOTHING", [readerOperatorId]); await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]); await grantProjectMembership(pool, readerOperatorId, projectId); });
  afterAll(async () => { await pool.end(); await basePool.query(`DROP SCHEMA ${schema} CASCADE`); await basePool.end(); });

  it("records a source-bound digest and makes identical retries idempotent", async () => {
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "digest-test", leaseDurationMs: 60_000 });
    const input = inputFor(goalId, projectId); const first = await recordImprovementDigest(pool, input, proof, author); const retry = await recordImprovementDigest(pool, input, proof, author);
    const uppercaseRetry = await recordImprovementDigest(pool, { ...input, projectId: projectId.toUpperCase(), goalId: goalId.toUpperCase(), sourceRefs: [{ kind: "goal", sourceId: goalId.toUpperCase() }] }, proof, author);
    expect(retry).toEqual(first); expect(uppercaseRetry).toEqual(first); expect(first).toMatchObject({ projectId, goalId, contentHash: expect.stringMatching(/^[0-9a-f]{64}$/), authorId: author.actorId });
    await expect(listImprovementDigests(pool, reader(projectId))).resolves.toEqual([first]);
    await expect(readImprovementDigest(pool, reader(projectId), first.digestId)).resolves.toEqual(first);
    await expect(listImprovementDigests(pool, reader(randomUUID()))).rejects.toThrow("no active membership");
    const otherOperator = randomUUID(); const otherProject = randomUUID();
    await pool.query("INSERT INTO local_operators (operator_id) VALUES ($1)", [otherOperator]);
    await grantProjectMembership(pool, otherOperator, otherProject);
    await expect(readImprovementDigest(pool, { operatorId: otherOperator, projectId: otherProject }, first.digestId)).rejects.toThrow("not found");
  });

  it("fails closed when Goal authority expires during the transaction", async () => {
    const proof = await acquireGoalLease(pool, { goalId, ownerId: randomUUID(), leaseDurationMs: 2000 });
    await expect(withGoalAuthority(pool, proof, 64, async (client) => { await client.query("SELECT pg_sleep(2.5)"); return true; })).rejects.toThrow("stale");
  });

  it("rejects changed retries, cross-project or missing sources, and direct mutation", async () => {
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "digest-test", leaseDurationMs: 60_000 }); const input = inputFor(goalId, projectId); const first = await recordImprovementDigest(pool, input, proof, author);
    let goalMutationError: unknown;
    try {
      await pool.query("UPDATE goals SET project_id = $1 WHERE goal_id = $2", [randomUUID(), goalId]);
    } catch (error) {
      goalMutationError = error;
    }
    if (goalMutationError === undefined) await pool.query("UPDATE goals SET project_id = $1 WHERE goal_id = $2", [projectId, goalId]);
    expect(goalMutationError).toBeDefined();
    const refreshTokenDetection = await pool.query<{ detected: boolean }>("SELECT improvement_digest_contains_secret_like($1) AS detected", ["refresh_token=not-a-secret"])
    expect(refreshTokenDetection.rows[0]!.detected).toBe(true);
    const hyphenatedRefreshTokenDetection = await pool.query<{ detected: boolean }>("SELECT improvement_digest_contains_secret_like($1) AS detected", ["refresh-token=not-a-secret"])
    expect(hyphenatedRefreshTokenDetection.rows[0]!.detected).toBe(true);
    await expect(recordImprovementDigest(pool, { ...input, observedResult: "changed" }, proof, author)).rejects.toThrow("content conflict");
    await expect(recordImprovementDigest(pool, { ...input, episodeId: "episode-2", projectId: randomUUID() }, proof, author)).rejects.toThrow("project");
    await expect(recordImprovementDigest(pool, { ...input, episodeId: "episode-3", sourceRefs: [{ kind: "goal", sourceId: randomUUID() }] }, proof, author)).rejects.toThrow("source");
    const incidentId = randomUUID(); const discordEvidenceId = randomUUID();
    await pool.query("INSERT INTO discord_incidents (incident_id, incident_fingerprint, affected_version, first_observed_at, last_observed_at, severity, confidence, affected_component, status, signal_count, linked_goal_id) VALUES ($1, $2, $3, transaction_timestamp(), transaction_timestamp(), 'warning', 0.8, 'control-plane', 'open', 1, $4)", [incidentId, `fingerprint-${incidentId}`, "version-1", goalId]);
    await pool.query("INSERT INTO discord_improvement_evidence (evidence_id, incident_id, outcome, severity, confidence) VALUES ($1, $2, 'resolved', 'warning', 0.8)", [discordEvidenceId, incidentId]);
    const directDigestSql = "INSERT INTO improvement_digests (digest_id, schema_version, project_id, goal_id, episode_id, trigger, situation, selected_decision, rejected_alternatives, observed_result, metrics, confidence, source_refs, content_hash, author_id, session_ref) VALUES ($1, 1, $2, $3, $4, 'goal_completed', 'situation', 'decision', $5::jsonb, 'result', $6::jsonb, 0.5, $7::jsonb, $8, 'actor', 'session')";
    const shadowSchema = `digest_shadow_${randomUUID().replaceAll("-", "")}`;
    await pool.query(`CREATE SCHEMA "${shadowSchema}"`);
    try {
      await pool.query(`CREATE FUNCTION "${shadowSchema}".improvement_digest_contains_secret_like(value text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT false $$`);
      await pool.query("BEGIN");
      try {
        await pool.query(`SET LOCAL search_path = "${shadowSchema}", "${schema}"`);
        await expect(pool.query("SELECT improvement_digest_contains_secret_like($1) AS detected", ["secret=x"])).resolves.toMatchObject({ rows: [{ detected: false }] });
        const shadowBypassInput = {
          ...inputFor(goalId, projectId), episodeId: "episode-search-path-shadow",
          rejectedAlternatives: ["secret=x"],
        };
        const shadowBypassHash = await pool.query<{ hash: string }>(
          `SELECT encode(public.digest("${schema}".improvement_digest_canonical_json($1::jsonb), 'sha256'), 'hex') AS hash`,
          [JSON.stringify(shadowBypassInput)],
        );
        await expect(pool.query(directDigestSql, [randomUUID(), projectId, goalId, shadowBypassInput.episodeId, JSON.stringify(shadowBypassInput.rejectedAlternatives), "[]", JSON.stringify(shadowBypassInput.sourceRefs), shadowBypassHash.rows[0]!.hash])).rejects.toThrow("unsafe");
      } finally {
        await pool.query("ROLLBACK");
      }
    } finally {
      await pool.query(`DROP SCHEMA "${shadowSchema}" CASCADE`);
    }
    await expect(pool.query(directDigestSql, [randomUUID(), projectId, goalId, "episode-open-discord", "[]", "[]", JSON.stringify([{ kind: "discord_improvement_evidence", sourceId: discordEvidenceId }]), "0".repeat(64)])).rejects.toThrow("closed");
    const uppercaseDigestId = randomUUID();
    const uppercaseSqlInput: ImprovementDigestInput = {
      schemaVersion: 1, projectId: projectId.toUpperCase(), goalId: goalId.toUpperCase(), episodeId: "episode-upper-sql", trigger: "goal_completed",
      situation: "situation", selectedDecision: "decision", rejectedAlternatives: [], observedResult: "result", metrics: [], confidence: 0.5,
      sourceRefs: [{ kind: "goal", sourceId: goalId.toUpperCase() }],
    };
    await pool.query(directDigestSql, [uppercaseDigestId, uppercaseSqlInput.projectId, uppercaseSqlInput.goalId, uppercaseSqlInput.episodeId, "[]", "[]", JSON.stringify(uppercaseSqlInput.sourceRefs), improvementDigestContentHash(uppercaseSqlInput)]);
    await expect(readImprovementDigest(pool, reader(projectId), uppercaseDigestId)).resolves.toMatchObject({ projectId, goalId, sourceRefs: [{ kind: "goal", sourceId: goalId }] });
    const precisionDigestId = randomUUID();
    const precisionSqlInput: ImprovementDigestInput = {
      ...uppercaseSqlInput, episodeId: "episode-precision-sql", metrics: [{ name: "ratio", value: Number("1.234567890123456789"), unit: "ratio" }],
    };
    await pool.query(directDigestSql, [precisionDigestId, precisionSqlInput.projectId, precisionSqlInput.goalId, precisionSqlInput.episodeId, "[]", JSON.stringify(precisionSqlInput.metrics), JSON.stringify(precisionSqlInput.sourceRefs), improvementDigestContentHash(precisionSqlInput)]);
    await expect(readImprovementDigest(pool, reader(projectId), precisionDigestId)).resolves.toMatchObject({ contentHash: improvementDigestContentHash(precisionSqlInput) });
    const discordInput = { ...input, episodeId: "episode-5", sourceRefs: [{ kind: "discord_improvement_evidence" as const, sourceId: discordEvidenceId }] };
    await expect(recordImprovementDigest(pool, discordInput, proof, author)).rejects.toThrow("source");
    await pool.query("UPDATE discord_incidents SET status = 'resolved', resolution_summary = 'closed', closed_at = transaction_timestamp() WHERE incident_id = $1", [incidentId]);
    await expect(recordImprovementDigest(pool, discordInput, proof, author)).resolves.toMatchObject({ episodeId: "episode-5" });
    await expect(recordImprovementDigest(pool, { ...input, episodeId: "episode-6", sourceRefs: [{ kind: "goal", sourceId: goalId }], situation: "-----BEGIN PRIVATE KEY-----" }, proof, author)).rejects.toThrow();
    await expect(recordImprovementDigest(pool, { ...input, episodeId: "episode-4" }, proof, { actorId: "sk-proj-12345678901234567890", sessionRef: author.sessionRef })).rejects.toThrow("author.actorId");
    await expect(pool.query(directDigestSql, [randomUUID(), projectId, goalId, "episode-bad-metric", "[]", JSON.stringify([{ name: "api_key", value: 1, unit: "count" }]), JSON.stringify([{ kind: "goal", sourceId: goalId }]), "0".repeat(64)])).rejects.toThrow("unsafe");
    await expect(pool.query(directDigestSql, [randomUUID(), projectId, goalId, "episode-bad-source", "[]", "[]", JSON.stringify([{ kind: "goal", sourceId: goalId, extra: "no" }]), "0".repeat(64)])).rejects.toThrow("malformed");
    await expect(pool.query(directDigestSql, [randomUUID(), projectId, goalId, "episode-duplicate-source", "[]", "[]", JSON.stringify([{ kind: "goal", sourceId: goalId }, { kind: "goal", sourceId: goalId }]), "0".repeat(64)])).rejects.toThrow("unique");
    await expect(pool.query(directDigestSql, [randomUUID(), projectId, goalId, "episode-bad-hash", "[]", "[]", JSON.stringify([{ kind: "goal", sourceId: goalId }]), "0".repeat(64)])).rejects.toThrow("hash");
    await expect(pool.query("INSERT INTO improvement_digests (digest_id, schema_version, project_id, goal_id, episode_id, trigger, situation, selected_decision, rejected_alternatives, observed_result, metrics, confidence, source_refs, content_hash, author_id, session_ref) VALUES ($1, 1, $2, $3, 'sql-cross-project', 'goal_completed', 'situation', 'decision', '[]', 'result', '[]', 0.5, $4, $5, 'actor', 'session')", [randomUUID(), randomUUID(), goalId, JSON.stringify([{ kind: "goal", sourceId: goalId }]), "0".repeat(64)])).rejects.toThrow("binding");
    await expect(pool.query("UPDATE improvement_digests SET observed_result = 'tampered' WHERE digest_id = $1", [first.digestId])).rejects.toThrow();
    await expect(pool.query("DELETE FROM improvement_digests WHERE digest_id = $1", [first.digestId])).rejects.toThrow();
    await expect(pool.query("TRUNCATE improvement_digests")).rejects.toThrow();
    const shadowProjectId = "33333333-3333-4333-8333-333333333333"; const shadowGoalId = "44444444-4444-4444-8444-444444444444"; const shadowDigestId = randomUUID();
    const shadowInput: ImprovementDigestInput = {
      schemaVersion: 1, projectId: shadowProjectId, goalId: shadowGoalId, episodeId: "episode-temp-shadow", trigger: "goal_completed",
      situation: "situation", selectedDecision: "decision", rejectedAlternatives: [], observedResult: "result", metrics: [], confidence: 0.5,
      sourceRefs: [{ kind: "goal", sourceId: shadowGoalId }],
    };
    const shadowClient = await pool.connect(); let shadowError: unknown;
    try {
      await shadowClient.query("CREATE TEMP TABLE goals (goal_id uuid, project_id uuid)");
      await shadowClient.query("INSERT INTO goals (goal_id, project_id) VALUES ($1, $2)", [shadowGoalId, shadowProjectId]);
      try { await shadowClient.query(directDigestSql, [shadowDigestId, shadowProjectId, shadowGoalId, shadowInput.episodeId, "[]", "[]", JSON.stringify(shadowInput.sourceRefs), improvementDigestContentHash(shadowInput)]); } catch (error) { shadowError = error; }
      if (shadowError === undefined) await shadowClient.query("DELETE FROM improvement_digests WHERE digest_id = $1", [shadowDigestId]);
    } finally { shadowClient.release(); }
    expect(shadowError).toBeDefined();
  });
});
