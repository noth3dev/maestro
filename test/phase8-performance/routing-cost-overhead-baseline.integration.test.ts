import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MODEL_CAPABILITY_AXES,
  assertValidModelMap,
  selectRoutedModel,
  toExecutionRef,
  toInvocationRef,
  type ExecutionAdmission,
  type ExecutionKernelPort,
  type InvocationObservation,
  type InvocationRef,
  type ModelMap,
  type ModelMapEntry,
  type OperationalOverlaySnapshot,
  type RoutingSelection,
  type SpawnRequest,
  type TaskCapabilityRequirements,
  type TaskDemand,
} from "@maestro/domain";
import { runMigrations } from "../../packages/persistence/src/migrate.js";
import { acquireGoalLease, releaseGoalLease, type GoalLeaseProof } from "../../packages/persistence/src/commands.js";
import { requestSemanticReview } from "../../packages/persistence/src/semantic-review.js";
import { runEncoreCouncilReview } from "../../packages/persistence/src/encore-council.js";
const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const SAMPLE_COUNT = 10;
const skillRefs = ["review"] as const;
const criteria = [{ criterionId: "evidence-cited", description: "the claim must cite durable evidence" }];

type Distribution = { readonly p50: number; readonly p95: number; readonly max: number };

type CostBound = {
  readonly state: "bounded";
  readonly basis: "total-token-rate-bound";
  readonly lowerUsd: number;
  readonly upperUsd: number;
};

interface RoutingCostBaseline {
  readonly metric: "model-skill-routing-quality-council-overhead";
  readonly database: "postgresql";
  readonly sampleCount: number;
  readonly routingMs: Distribution;
  readonly qualityOverheadMs: Distribution;
  readonly councilOverheadMs: Distribution;
  readonly totalTokens: Distribution;
  readonly tokenCostEstimateUsd: { readonly lower: Distribution; readonly upper: Distribution; readonly basis: CostBound["basis"] };
  readonly skillRouting: { readonly refs: readonly string[]; readonly count: Distribution; readonly pricing: "unavailable" };
  readonly reviewOverhead: { readonly semanticReviewsPerGoal: Distribution; readonly councilReviewersPerGoal: Distribution; readonly nativeBindingsPerGoal: Distribution; readonly usageObservationsPerGoal: Distribution };
  readonly samples: readonly {
    readonly goalId: string;
    readonly mode: RoutingSelection["mode"];
    readonly selectedModelRef: string;
    readonly candidateCount: number;
    readonly rejectedCount: number;
    readonly skillRefs: readonly string[];
    readonly totalTokens: number;
    readonly tokenCostEstimate: CostBound;
  }[];
}

function percentile(samples: readonly number[], quantile: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))]!;
}

function distribution(samples: readonly number[]): Distribution {
  return { p50: percentile(samples, 0.5), p95: percentile(samples, 0.95), max: Math.max(...samples) };
}

function taskDemand(): TaskDemand {
  const requirements = Object.fromEntries(
    MODEL_CAPABILITY_AXES.map((axis) => [axis, { level: 0, rationale: "bounded phase-8 benchmark demand" }]),
  ) as TaskCapabilityRequirements;
  return {
    schemaVersion: 1,
    taskKinds: ["research"],
    requirements,
    provenance: { taskContractRef: "phase8-s5-benchmark-contract", headDecisionRef: "phase8-s5-benchmark-decision" },
  };
}

function routingOverlay(goalId: string, projectId: string, candidates: readonly { readonly candidateRef: string; readonly accountBinding: string }[]): OperationalOverlaySnapshot {
  return {
    schemaVersion: 1,
    installationRef: "phase8-s5-routing-benchmark",
    projectRef: projectId,
    goalRef: goalId,
    overlayVersion: 1,
    observations: candidates.map((candidate, index) => ({
      candidateRef: candidate.candidateRef,
      measuredLatencyMs: index + 1,
      measuredCost: 0,
      failureRate: 0,
      timeoutRate: 0,
      providerErrorRate: 0,
      currentAvailability: true,
      accountBinding: candidate.accountBinding,
      observedAt: new Date().toISOString(),
    })),
  };
}

function parseModelIdentity(modelRef: string): { readonly provider: string; readonly id: string } {
  const separator = modelRef.indexOf("/");
  return { provider: modelRef.slice(0, separator), id: modelRef.slice(separator + 1) };
}

function admissionFor(goalId: string, projectId: string, proof: GoalLeaseProof, modelRef: string, lane: string, index: number): ExecutionAdmission {
  return {
    context: {
      operatorId: "phase8-s5-benchmark",
      projectId,
      goalId,
      missionBundleId: `phase8-s5-benchmark-bundle:${goalId}`,
      policyVersion: "phase8-s5-benchmark-policy",
      fencingToken: proof.fencingToken,
      accountRef: "phase8-s5-benchmark-account",
    },
    grant: {
      grantId: `phase8-s5-${lane}-grant:${goalId}:${index}`,
      allowedTools: [],
      allowedSkills: [...skillRefs],
      modelPolicy: [modelRef],
      pathScope: [],
      outboundDataClasses: ["repository files only"],
      remaining: { modelTurns: 2, toolCalls: 0, childCalls: 0, outputTokens: 2048, wallTimeMs: 20_000, retryCount: 0 },
    },
    modelPolicy: [modelRef],
    idempotencyKey: `phase8-s5-${lane}:${goalId}:${index}`,
  };
}

function fakeReviewKernel(modelRef: string, evidenceId: string, stats: { spawnRequests: SpawnRequest[]; usageObservations: number; observedTotalTokens: number }): ExecutionKernelPort {
  const identity = parseModelIdentity(modelRef);
  let counter = 0;
  const prefix = randomUUID();
  const invocations = new Map<string, InvocationRef>();
  const semanticExecutions = new Set<string>();
  return {
    async spawn(request: SpawnRequest) {
      const execution = toExecutionRef(`phase8-s5-routing-execution-${prefix}-${counter}`);
      const invocation = toInvocationRef(`phase8-s5-routing-invocation-${prefix}-${counter}`);
      counter += 1;
      invocations.set(String(execution), invocation);
      if (request.name.startsWith("semantic-review:")) semanticExecutions.add(execution);
      stats.spawnRequests.push(request);
      return { execution, invocation };
    },
    async prompt() {},
    async sendMessage() {},
    async observe(execution) {
      const invocation = invocations.get(String(execution));
      if (invocation === undefined) throw new Error("benchmark execution is unknown");
      stats.usageObservations += 1;
      const name = "benchmark-review";
      const isSemantic = semanticExecutions.has(execution);
      const answer = isSemantic
        ? JSON.stringify({ verdict: "supported", citedEvidenceIds: [evidenceId], reasoning: "durable benchmark evidence supports the claim" })
        : JSON.stringify({ verdict: "proceed", confidence: "high", reasoning: "durable benchmark evidence supports proceeding", conditions: [], dissentNote: null, citedEvidenceIds: [evidenceId] });
      const observation: InvocationObservation = {
        invocation,
        name,
        status: "succeeded",
        toolEvents: { state: "empty", events: [] },
        usage: { state: "available", totalTokens: 35 },
        answer: { state: "available", text: answer },
      };
      if (observation.usage.state === "available") stats.observedTotalTokens += observation.usage.totalTokens;
      return [observation];
    },
    async cancel() { return { cancelled: true }; },
    async getModelIdentity() { return identity; },
    async getExecutionBinding() { return { model: identity, accountRef: "phase8-s5-benchmark-account" }; },
    async getToolEvents() { return { state: "empty", events: [] }; },
    async getUsage() { return { state: "available", totalTokens: 35 }; },
    async getInvocationStatus() { return "succeeded"; },
    async resume() { throw new Error("not supported"); },
    async reconnect() { throw new Error("not supported"); },
    async release() {},
  };
}

function costBound(totalTokens: number, entry: ModelMapEntry): CostBound {
  const rates = [entry.providerFacts.pricing.inputPerMillionTokens, entry.providerFacts.pricing.outputPerMillionTokens];
  return {
    state: "bounded",
    basis: "total-token-rate-bound",
    lowerUsd: totalTokens * Math.min(...rates) / 1_000_000,
    upperUsd: totalTokens * Math.max(...rates) / 1_000_000,
  };
}

async function setupGoal(pool: Pool): Promise<{ readonly goalId: string; readonly projectId: string; readonly evidenceId: string; readonly proof: GoalLeaseProof }> {
  const goalId = randomUUID();
  const projectId = randomUUID();
  const evidenceId = randomUUID();
  await pool.query(
    "INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())",
    [goalId, projectId],
  );
  await pool.query(
    "INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'test-result', 'text/plain', 'project_lifetime')",
    [evidenceId, randomUUID(), randomUUID(), projectId, goalId, "phase8-s5-benchmark", "0".repeat(64)],
  );
  const proof = await acquireGoalLease(pool, { goalId, ownerId: "phase8-s5-routing-benchmark", leaseDurationMs: 120_000 });
  return { goalId, projectId, evidenceId, proof };
}

describeDatabase("Plan 8 §S5 model/skill routing cost and Quality/Council overhead baseline", () => {
  const schema = `phase8_s5_routing_${randomUUID().replaceAll("-", "")}`;
  const basePool = new Pool({ connectionString: databaseUrl ?? "" });
  const scopedUrl = databaseUrl === undefined ? "" : (() => { const url = new URL(databaseUrl); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })();
  const pool = new Pool({ connectionString: scopedUrl });
  const modelMapValue = JSON.parse(readFileSync(new URL("../../config/model_map.json", import.meta.url), "utf8")) as unknown;
  let modelMap: ModelMap;

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA "${schema}"`);
    await runMigrations(pool);
    assertValidModelMap(modelMapValue);
    modelMap = modelMapValue;
  });

  afterAll(async () => {
    await pool.end();
    await basePool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await basePool.end();
  });

  it("records bounded route selection, declarative skill propagation, and durable review overhead per Goal", async () => {
    const routeTimes: number[] = [];
    const qualityTimes: number[] = [];
    const councilTimes: number[] = [];
    const tokenSamples: number[] = [];
    const lowerCostSamples: number[] = [];
    const upperCostSamples: number[] = [];
    const skillCountSamples: number[] = [];
    const semanticCountSamples: number[] = [];
    const councilReviewerCountSamples: number[] = [];
    const bindingCountSamples: number[] = [];
    const usageObservationSamples: number[] = [];
    const samples: Array<RoutingCostBaseline["samples"][number]> = [];

    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      const { goalId, projectId, evidenceId, proof } = await setupGoal(pool);
      const candidateInput = modelMap.entries.slice(0, 2).map((entry, candidateIndex) => ({ candidateRef: `phase8-candidate-${index}-${candidateIndex}`, modelRef: entry.modelRef, accountBinding: "phase8-s5-benchmark-account" }));
      const routeStarted = performance.now();
      const selection = selectRoutedModel({
        mode: index % 2 === 0 ? "pin" : "ensemble",
        goalRef: goalId,
        approvedModels: candidateInput.map((candidate) => candidate.modelRef),
        pinModelRef: index % 2 === 0 ? candidateInput[index % candidateInput.length]!.modelRef : undefined,
        taskDemand: taskDemand(),
        modelMap,
        operationalOverlay: routingOverlay(goalId, projectId, candidateInput),
        candidates: candidateInput,
        pressure: 0,
      });
      routeTimes.push(performance.now() - routeStarted);
      const modelEntry = modelMap.entries.find((entry) => entry.modelRef === selection.selectedModelRef);
      if (modelEntry === undefined) throw new Error("selected benchmark model is missing from the model map");
      const stats: { spawnRequests: SpawnRequest[]; usageObservations: number; observedTotalTokens: number } = { spawnRequests: [], usageObservations: 0, observedTotalTokens: 0 };
      const kernel = fakeReviewKernel(selection.selectedModelRef, evidenceId, stats);

      const qualityStarted = performance.now();
      const semantic = await requestSemanticReview(
        pool,
        kernel,
        goalId,
        "the bounded route has durable evidence",
        criteria,
        admissionFor(goalId, projectId, proof, selection.selectedModelRef, "semantic", 0),
        randomUUID(),
      );
      qualityTimes.push(performance.now() - qualityStarted);

      const councilStarted = performance.now();
      const council = await runEncoreCouncilReview(pool, kernel, {
        goalId,
        proof,
        commandId: randomUUID(),
        question: "should this bounded route proceed?",
        criteria,
        evidenceIds: [evidenceId],
        reviewerCount: 2,
        admission: (reviewerIndex) => admissionFor(goalId, projectId, proof, selection.selectedModelRef, "council", reviewerIndex),
      });
      councilTimes.push(performance.now() - councilStarted);

      const totalTokens = stats.observedTotalTokens;
      const estimate = costBound(totalTokens, modelEntry);
      const bindingRows = await pool.query<{
        goal_id: string; project_id: string; admission_kind: string;
        selected_model_provider: string; selected_model_id: string;
        actual_model_provider: string; actual_model_id: string; account_ref: string | null;
      }>(
        `SELECT goal_id, project_id, admission_kind, selected_model_provider, selected_model_id,
                actual_model_provider, actual_model_id, account_ref
           FROM native_execution_bindings WHERE goal_id = $1 ORDER BY admission_kind, binding_id`,
        [goalId],
      );
      const semanticRows = await pool.query("SELECT goal_id, verdict FROM semantic_reviews WHERE goal_id = $1", [goalId]);
      const councilRows = await pool.query("SELECT r.goal_id, j.model_provider, j.model_id FROM encore_council_judgments j JOIN encore_council_rounds r ON r.round_id = j.round_id WHERE r.goal_id = $1 ORDER BY j.reviewer_index", [goalId]);
      const lease = await pool.query("SELECT 1 FROM goal_leases WHERE goal_id = $1 AND owner_id = $2 AND fencing_token = $3::bigint AND expires_at > clock_timestamp()", [goalId, proof.ownerId, proof.fencingToken]);
      const selectedIdentity = parseModelIdentity(selection.selectedModelRef);
      const skillBindings = stats.spawnRequests.map((request) => request.grant?.allowedSkills ?? []);
      const routedSkillRefs = [...new Set(skillBindings.flat())];
      const bindingKinds = bindingRows.rows.map((row) => row.admission_kind).sort();

      expect(candidateInput.map((candidate) => candidate.modelRef)).toContain(selection.selectedModelRef);
      expect(semantic.verdict).toBe("supported");
      expect(council.judgments).toHaveLength(2);
      expect(council.synthesis.finalVerdict).toBe("proceed");
      expect(stats.usageObservations).toBe(3);
      expect(totalTokens).toBe(105);
      expect(skillBindings).toHaveLength(3);
      expect(skillBindings.every((skills) => skills.length === skillRefs.length && skills.every((skill) => skillRefs.includes(skill as typeof skillRefs[number])))).toBe(true);
      expect(bindingRows.rows).toHaveLength(3);
      expect(bindingKinds).toEqual(["encore_reviewer", "encore_reviewer", "semantic_review"]);
      expect(bindingRows.rows.every((row) => row.goal_id === goalId && row.project_id === projectId && row.selected_model_provider === selectedIdentity.provider && row.selected_model_id === selectedIdentity.id && row.actual_model_provider === selectedIdentity.provider && row.actual_model_id === selectedIdentity.id && row.account_ref === "phase8-s5-benchmark-account")).toBe(true);
      expect(semanticRows.rows).toHaveLength(1);
      expect(councilRows.rows).toHaveLength(2);
      expect(lease.rowCount).toBe(1);

      tokenSamples.push(totalTokens);
      lowerCostSamples.push(estimate.lowerUsd);
      upperCostSamples.push(estimate.upperUsd);
      skillCountSamples.push(skillBindings[0]?.length ?? 0);
      semanticCountSamples.push(semanticRows.rows.length);
      councilReviewerCountSamples.push(councilRows.rows.length);
      bindingCountSamples.push(bindingRows.rows.length);
      usageObservationSamples.push(stats.usageObservations);
      samples.push({ goalId, mode: selection.mode, selectedModelRef: selection.selectedModelRef, candidateCount: candidateInput.length, rejectedCount: selection.rejected.length, skillRefs: routedSkillRefs, totalTokens, tokenCostEstimate: estimate });
      await releaseGoalLease(pool, proof);
    }

    const baseline: RoutingCostBaseline = {
      metric: "model-skill-routing-quality-council-overhead",
      database: "postgresql",
      sampleCount: samples.length,
      routingMs: distribution(routeTimes),
      qualityOverheadMs: distribution(qualityTimes),
      councilOverheadMs: distribution(councilTimes),
      totalTokens: distribution(tokenSamples),
      tokenCostEstimateUsd: { lower: distribution(lowerCostSamples), upper: distribution(upperCostSamples), basis: "total-token-rate-bound" },
      skillRouting: { refs: [...new Set(samples.flatMap((sample) => sample.skillRefs))], count: distribution(skillCountSamples), pricing: "unavailable" },
      reviewOverhead: { semanticReviewsPerGoal: distribution(semanticCountSamples), councilReviewersPerGoal: distribution(councilReviewerCountSamples), nativeBindingsPerGoal: distribution(bindingCountSamples), usageObservationsPerGoal: distribution(usageObservationSamples) },
      samples,
    };
    console.log(`PHASE8_PERFORMANCE_BASELINE ${JSON.stringify(baseline)}`);
    expect(baseline.sampleCount).toBe(SAMPLE_COUNT);
  });
});
