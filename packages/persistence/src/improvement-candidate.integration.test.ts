import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  improvementCandidateScenarioSuiteHash,
  type ImprovementCandidateInput,
} from "@maestro/domain";
import { applyAllMigrations } from "./test-migrations.js";
import { acquireGoalLease } from "./commands.js";
import { grantProjectMembership, grantProjectRole } from "./project-membership.js";
import { recordImprovementDigest } from "./improvement-digest.js";
import {
  appendImprovementCandidateVersion,
  listImprovementCandidateVersions,
  readImprovementCandidate,
  recordImprovementCandidate,
  transitionImprovementCandidate,
  type ImprovementCandidateAuthor,
} from "./improvement-candidate.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL ?? "postgresql://127.0.0.1/maestro_test";
const describeDatabase = process.env.MAESTRO_TEST_DATABASE_URL ? describe : describe.skip;
const operatorId = randomUUID();
const author: ImprovementCandidateAuthor = {
  authorId: "worker-engineering",
  sessionRef: "session:candidate",
  operatorId,
  operatorRoleId: "engineering",
};

describeDatabase("Improvement Candidate persistence", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  const schema = `candidate_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = (() => { const url = new URL(databaseUrl); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })();
  let pool: Pool;
  let projectId: string;
  let goalId: string;
  let digestId: string;
  let proof: Awaited<ReturnType<typeof acquireGoalLease>>;

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: scopedUrl });
    await applyAllMigrations(pool);
  });

  beforeEach(async () => {
    projectId = randomUUID();
    goalId = randomUUID();
    await pool.query("INSERT INTO local_operators (operator_id) VALUES ($1) ON CONFLICT DO NOTHING", [operatorId]);
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectRole(pool, operatorId, projectId, "engineering");
    proof = await acquireGoalLease(pool, { goalId, ownerId: "candidate-worker", leaseDurationMs: 60_000 });
    const digest = await recordImprovementDigest(pool, {
      schemaVersion: 1, projectId, goalId, episodeId: `candidate-episode-${randomUUID()}`, trigger: "goal_completed",
      situation: "The bounded implementation completed with a measurable review outcome.",
      selectedDecision: "Keep the deterministic validation gate.", rejectedAlternatives: ["Skip the gate."],
      observedResult: "The required safety checks remained intact.", metrics: [{ name: "useful_findings", value: 2, unit: "count" }],
      confidence: 0.9, sourceRefs: [{ kind: "goal", sourceId: goalId }],
    }, proof, { actorId: author.authorId, sessionRef: author.sessionRef, operatorId });
    digestId = digest.digestId;
  });

  afterAll(async () => { await pool.end(); await basePool.query(`DROP SCHEMA ${schema} CASCADE`); await basePool.end(); });

  const inputFor = (overrides: Partial<ImprovementCandidateInput> = {}): ImprovementCandidateInput => ({
    schemaVersion: 1, projectId, goalId, kind: "persona_axis",
    target: { roleId: "head-engineering", taskClass: "implementation" },
    changes: [{ axis: "caution", currentValue: 0.7, proposedValue: 0.76 }],
    sourceEvidenceIds: [digestId],
    evidencePattern: "Comparable Goals recorded avoidable risk-review omissions.",
    predictedEffect: "The role will surface reversible-risk checks earlier.",
    expectedMetrics: [{ name: "useful_risk_findings", unit: "count", direction: "increase", target: 1 }],
    protectedMetrics: [{ name: "correctness", unit: "score", minimum: 0.9, maximum: 1 }],
    scenarioSuite: ["implementation-risk-review-v1"],
    scenarioSuiteHash: improvementCandidateScenarioSuiteHash(["implementation-risk-review-v1"]),
    confidence: 0.84, dataSufficiency: { episodeCount: 3, comparableGoalCount: 2 },
    rollbackTarget: { candidateId: randomUUID(), version: 1, contentHash: "0".repeat(64) },
    ...overrides,
  });

  it("stores one shared candidate shape for persona and routing targets", async () => {
    const persona = await recordImprovementCandidate(pool, inputFor(), proof, author, "persona-1");
    const routing = await recordImprovementCandidate(pool, inputFor({
      kind: "routing_capability_axis", target: { routingTarget: "openai/gpt-5" },
      changes: [{ axis: "verification", currentValue: 120, proposedValue: 135 }],
    }), proof, author, "routing-1");

    expect(persona.state).toBe("candidate");
    expect(routing.state).toBe("candidate");
    expect(await transitionImprovementCandidate(pool, persona.candidateId, "evaluated", proof, author, "persona-evaluated")).toMatchObject({ state: "evaluated", version: 2, parentCandidateId: persona.candidateId });
    expect(await transitionImprovementCandidate(pool, routing.candidateId, "evaluated", proof, author, "routing-evaluated")).toMatchObject({ state: "evaluated", version: 2, parentCandidateId: routing.candidateId });
  });

  it("rejects a fabricated or cross-Goal Improvement Digest reference", async () => {
    await expect(recordImprovementCandidate(pool, inputFor({ sourceEvidenceIds: [randomUUID()] }), proof, author, "dangling-source")).rejects.toThrow(/digest|source|evidence/i);
    const otherGoalId = randomUUID();
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [otherGoalId, projectId]);
    await expect(recordImprovementCandidate(pool, inputFor({ goalId: otherGoalId }), proof, author, "cross-goal")).rejects.toThrow(/Goal|lease|project/i);
  });

  it("appends immutable revisions with parent lineage and preserves the original row", async () => {
    const first = await recordImprovementCandidate(pool, inputFor(), proof, author, "revision-1");
    const second = await appendImprovementCandidateVersion(pool, first.candidateId, inputFor({ predictedEffect: "The revised role will surface checks before implementation." }), proof, author, "revision-2");
    expect(second).toMatchObject({ version: 2, parentCandidateId: first.candidateId, candidateId: expect.not.stringMatching(first.candidateId) });
    await expect(readImprovementCandidate(pool, first.candidateId)).resolves.toEqual(first);
    await expect(listImprovementCandidateVersions(pool, first.candidateId)).resolves.toEqual([first, second]);
    await expect(pool.query("UPDATE improvement_candidates SET predicted_effect = 'tampered' WHERE candidate_id = $1", [first.candidateId])).rejects.toThrow(/append-only|immutable|mutation/i);
    await expect(pool.query("DELETE FROM improvement_candidates WHERE candidate_id = $1", [first.candidateId])).rejects.toThrow(/append-only|immutable|mutation/i);
  });

  it("requires lifecycle transitions instead of allowing a direct state skip", async () => {
    const candidate = await recordImprovementCandidate(pool, inputFor(), proof, author, "lifecycle");
    await expect(transitionImprovementCandidate(pool, candidate.candidateId, "judged", proof, author, "skip-judged")).rejects.toThrow(/transition|evaluated|state/i);
    const evaluated = await transitionImprovementCandidate(pool, candidate.candidateId, "evaluated", proof, author, "lifecycle-evaluated");
    const judged = await transitionImprovementCandidate(pool, evaluated.candidateId, "judged", proof, author, "lifecycle-judged");
    await expect(transitionImprovementCandidate(pool, judged.candidateId, "applied", proof, author, "lifecycle-applied")).resolves.toMatchObject({ state: "applied", version: 4 });
  });
});
