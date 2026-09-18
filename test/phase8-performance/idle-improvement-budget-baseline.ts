import { performance } from "node:perf_hooks";
import {
  improvementCandidateContentHash,
  improvementCandidateScenarioSuiteHash,
  type ImprovementCandidateInput,
} from "../../packages/domain/src/index.js";
import {
  replayCandidateAgainstFrozenBaseline,
  runSyntheticAdversarialScenarios,
  SYNTHETIC_SCENARIO_SPECS,
} from "../../packages/domain/src/index.js";
import { runShadowEvaluation, type ShadowEvaluationEvidence, type ShadowOutput } from "../../packages/domain/src/index.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const GOAL_ID = "22222222-2222-4222-8222-222222222222";
const DIGEST_ID = "33333333-3333-4333-8333-333333333333";
const ROLLBACK_CANDIDATE_ID = "44444444-4444-4444-8444-444444444444";
const TEST_FIXTURE_BUDGET_UNITS = 3;

export interface IdleBudgetObservation {
  readonly operation: "replay" | "synthetic" | "shadow";
  readonly outcome: "executed" | "yielded";
  readonly workUnits: number;
  readonly reason: string;
  readonly candidateContentHash: string;
  readonly auditable: true;
}

export interface IdleImprovementBudgetBaseline {
  readonly metric: "idle-improvement-budget";
  readonly database: "runtime";
  readonly status: "provisional-unimplemented";
  readonly productionIdleConsumer: "unimplemented";
  readonly productBudgetDeclared: false;
  readonly candidateContentHash: string;
  readonly fixture: {
    readonly scope: "test-only";
    readonly simulationOnly: true;
    readonly declaredWorkUnits: number;
    readonly consumedWorkUnits: number;
    readonly elapsedMs: number;
    readonly yieldedBeforeEligibleGoal: boolean;
    readonly eligibilitySource: "scripted-test-fixture";
    readonly authoritativeGoalRead: false;
    readonly timeBoundEnforced: false;
  };
  readonly replay: { readonly status: "compared" | "invalidated" | "rejected"; readonly resultCount: number };
  readonly synthetic: { readonly status: "completed" | "rejected"; readonly scenarioCount: number };
  readonly shadow: {
    readonly status: "completed" | "interrupted";
    readonly recordCount: number;
    readonly deniedEffects: number;
    readonly liveEffects: number;
    readonly journalEvents: readonly string[];
    readonly evidencePersistence: "in-memory-test-sink";
    readonly committedEvidence: true;
    readonly committedCandidateContentHash: string;
    readonly committedRunId: string;
  };
  readonly observations: readonly IdleBudgetObservation[];
  readonly observationDurability: "in-memory-test-fixture";
  readonly durableAuditRecord: false;
  readonly providerCalls: 0;
  readonly tokens: 0;
  readonly cost: 0;
}

function candidate(): ImprovementCandidateInput {
  const scenarioSuite = SYNTHETIC_SCENARIO_SPECS.map((scenario) => scenario.scenarioId);
  return {
    schemaVersion: 1,
    projectId: PROJECT_ID,
    goalId: GOAL_ID,
    kind: "persona_axis",
    target: { roleId: "head-engineering", taskClass: "implementation" },
    changes: [{ axis: "caution", currentValue: 0.7, proposedValue: 0.76 }],
    sourceEvidenceIds: [DIGEST_ID],
    evidencePattern: "Repeated risk-review omissions.",
    predictedEffect: "Surface reversible-risk checks earlier.",
    expectedMetrics: [{ name: "useful_risk_findings", unit: "count", direction: "increase", target: 1 }],
    protectedMetrics: [{ name: "correctness", unit: "score", minimum: 0.9, maximum: 1 }],
    scenarioSuite,
    scenarioSuiteHash: improvementCandidateScenarioSuiteHash(scenarioSuite),
    confidence: 0.84,
    dataSufficiency: { episodeCount: 3, comparableGoalCount: 2 },
    rollbackTarget: { candidateId: ROLLBACK_CANDIDATE_ID, version: 1, contentHash: "0".repeat(64) },
  };
}

const metrics = { correctness: 0.98, safety: 0.99, authority: 1, cost: 0 };
const activeOutput: ShadowOutput = {
  messages: ["I will inspect the diff before proposing a change."],
  plans: [{ step: "inspect" }],
  challenges: [{ kind: "risk-review" }],
};

export async function measureIdleImprovementBudgetBaseline(): Promise<IdleImprovementBudgetBaseline> {
  const started = performance.now();
  const input = candidate();
  const candidateContentHash = improvementCandidateContentHash(input);
  const observations: IdleBudgetObservation[] = [];
  let eligibleGoalNeedsCapacity = false;

  async function run(operation: IdleBudgetObservation["operation"], work: () => Promise<unknown>): Promise<unknown> {
    if (eligibleGoalNeedsCapacity) {
      observations.push({
        operation,
        outcome: "yielded",
        workUnits: 0,
        reason: "eligible-ceo-goal-needs-capacity",
        candidateContentHash,
        auditable: true,
      });
      return undefined;
    }
    const result = await work();
    observations.push({
      operation,
      outcome: "executed",
      workUnits: 1,
      reason: "no-eligible-ceo-goal-needs-capacity",
      candidateContentHash,
      auditable: true,
    });
    return result;
  }

  const replay = (await run("replay", async () =>
    replayCandidateAgainstFrozenBaseline(input, {
      scenarioSuite: input.scenarioSuite,
      goals: [{ goalId: GOAL_ID, input: { request: "review the change" }, baseline: metrics }],
      evaluate: () => metrics,
    }),
  )) as ReturnType<typeof replayCandidateAgainstFrozenBaseline>;

  const synthetic = (await run("synthetic", async () =>
    runSyntheticAdversarialScenarios(input, {
      scenarios: SYNTHETIC_SCENARIO_SPECS,
      evaluate: () => metrics,
    }),
  )) as ReturnType<typeof runSyntheticAdversarialScenarios>;

  const journalEvents: string[] = [];
  let committedEvidence: ShadowEvaluationEvidence | undefined;
  const shadow = (await run("shadow", async () =>
    runShadowEvaluation({
      candidate: input,
      cases: [{ input: { request: "review the change" }, activeInput: { request: "review the change" }, active: activeOutput }],
      recordedEvidence: { [DIGEST_ID]: { kind: "test-result", content: "observed" } },
      evaluate: async (_receivedInput, context) => {
        context.readRecordedEvidence(DIGEST_ID);
        await context.attemptEffect({ action: "project.file.write", target: "/repo/file" }, async () => undefined).catch(() => undefined);
        return activeOutput;
      },
      journal: {
        append: async (event) => {
          journalEvents.push(event.event);
        },
      },
      resultSink: {
        commit: async (evidence: ShadowEvaluationEvidence, lifecycle) => {
          committedEvidence = evidence;
          const common = {
            sessionId: evidence.identity.sessionId,
            processRef: evidence.identity.processRef,
            projectId: evidence.identity.projectId,
            goalId: evidence.identity.goalId,
            processPid: evidence.identity.processPid,
            details: { shadow_run_id: evidence.identity.runId },
          };
          await lifecycle.append({ ...common, event: "orphaned", reason: "shadow_run_completed" });
          await lifecycle.append({ ...common, event: "completed", reason: `shadow_run_completed:${evidence.result.records.length}` });
        },
      },
      runId: "shadow-run-idle-budget-1",
      processRef: "shadow-process-idle-budget-1",
      sessionId: "shadow-session-idle-budget-1",
      processPid: 4321,
    }),
  )) as Awaited<ReturnType<typeof runShadowEvaluation>>;

  eligibleGoalNeedsCapacity = true;
  await run("shadow", async () => shadow);

  const consumedWorkUnits = observations.reduce((total, observation) => total + observation.workUnits, 0);
  if (committedEvidence === undefined) throw new Error("shadow evidence was not captured by the in-memory test sink");
  return {
    metric: "idle-improvement-budget",
    database: "runtime",
    status: "provisional-unimplemented",
    productionIdleConsumer: "unimplemented",
    productBudgetDeclared: false,
    candidateContentHash,
    fixture: {
      scope: "test-only",
      simulationOnly: true,
      declaredWorkUnits: TEST_FIXTURE_BUDGET_UNITS,
      consumedWorkUnits,
      elapsedMs: performance.now() - started,
      yieldedBeforeEligibleGoal: observations.some((observation) => observation.outcome === "yielded"),
      eligibilitySource: "scripted-test-fixture",
      authoritativeGoalRead: false,
      timeBoundEnforced: false,
    },
    replay: { status: replay.status, resultCount: replay.status === "compared" ? replay.results.length : 0 },
    synthetic: { status: synthetic.status, scenarioCount: synthetic.status === "completed" ? synthetic.results.length : 0 },
    shadow: {
      status: shadow.status,
      recordCount: shadow.records.length,
      deniedEffects: shadow.deniedEffects.length,
      liveEffects: shadow.liveEffects.length,
      journalEvents,
      evidencePersistence: "in-memory-test-sink",
      committedEvidence: true,
      committedCandidateContentHash: committedEvidence.candidateContentHash,
      committedRunId: committedEvidence.identity.runId,
    },
    observations,
    observationDurability: "in-memory-test-fixture",
    durableAuditRecord: false,
    providerCalls: 0,
    tokens: 0,
    cost: 0,
  };
}
