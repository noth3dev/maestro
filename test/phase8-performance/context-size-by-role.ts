import type { ModelMessage, ModelGatewayPort, GatewayBinding, GatewayTurnRequest } from "../../packages/agent-runtime/src/index.js";
import { createMaestroAgentRuntime, ToolRegistry } from "../../packages/agent-runtime/src/index.js";
import type { CapabilityGrant, ExecutionAdmission, ModelIdentity, SpawnRequest, WorkerProfileAssignment } from "@maestro/domain";
import { buildSemanticReviewPrompt } from "../../packages/domain/src/index.js";

export type ContextRole = "head" | "worker" | "team-lead-helper" | "encore-reviewer" | "semantic-reviewer" | "conversation";

export interface ContextSizeSummary {
  readonly role: ContextRole;
  readonly sampleCount: number;
  readonly contextBytes: { readonly p50: number; readonly p95: number; readonly max: number };
  readonly messageCounts: { readonly p50: number; readonly p95: number; readonly max: number };
  readonly toolCounts: { readonly p50: number; readonly p95: number; readonly max: number };
}

interface CapturedContext {
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly unknown[];
}

const model: ModelIdentity = { provider: "benchmark", id: "context-size" };
const modelRef = "benchmark/context-size";
const binding: GatewayBinding = {
  bindingId: "context-binding", gatewayInstanceId: "context-gateway", provider: model,
  account: { providerId: "benchmark", accountRef: "context-account", authMode: "api-key" }, dataPolicyHash: "context-policy",
};

function percentile(samples: readonly number[], quantile: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))]!;
}

function summary(role: ContextRole, contexts: readonly CapturedContext[]): ContextSizeSummary {
  const sizes = contexts.map((context) => Buffer.byteLength(JSON.stringify({ messages: context.messages, tools: context.tools }), "utf8"));
  const messageCounts = contexts.map((context) => context.messages.length);
  const toolCounts = contexts.map((context) => context.tools.length);
  return {
    role, sampleCount: contexts.length,
    contextBytes: { p50: percentile(sizes, 0.5), p95: percentile(sizes, 0.95), max: Math.max(...sizes) },
    messageCounts: { p50: percentile(messageCounts, 0.5), p95: percentile(messageCounts, 0.95), max: Math.max(...messageCounts) },
    toolCounts: { p50: percentile(toolCounts, 0.5), p95: percentile(toolCounts, 0.95), max: Math.max(...toolCounts) },
  };
}

function grant(role: ContextRole, sample: number, parentGrantId?: string): CapabilityGrant {
  return {
    grantId: `${role}-grant-${sample}`, ...(parentGrantId === undefined ? {} : { parentGrantId }),
    allowedTools: [], allowedSkills: [], modelPolicy: [modelRef],
    pathScope: ["packages", "apps"], outboundDataClasses: ["workspace"],
    remaining: { modelTurns: 1, toolCalls: 2, childCalls: parentGrantId === undefined ? 1 : 0, outputTokens: 512, wallTimeMs: 30_000, retryCount: 0 },
  };
}

function context(role: ContextRole, sample: number) {
  return { operatorId: `operator-${sample}`, projectId: `project-${sample}`, goalId: `goal-${sample}`, missionBundleId: `bundle-${role}`, policyVersion: "phase8-context-baseline", authorityPolicyVersion: 1, controlEpoch: "1", budgetEffectCents: 0, accountRef: binding.account.accountRef, leaseRef: `lease-${sample}`, fencingToken: "1" };
}

function workerProfile(sample: number): WorkerProfileAssignment {
  return {
    profile: { agreeableness: 0.7, extraversion: 0.5, imagination: 0.6, realism: 0.8, conscientiousness: 0.9, caution: 0.85, initiative: 0.75, empathy: 0.65, adaptability: 0.7, sociability: 0.55 },
    explanations: [{ axis: "conscientiousness", delta: 0.05, absoluteDelta: 0.05, assignmentRef: `assignment-${sample}`, reason: "head delegation plus mission overlay" }],
    assignmentRef: `assignment-${sample}`,
  };
}

function promptFor(role: Exclude<ContextRole, "team-lead-helper">, sample: number): string {
  const suffix = sample === 0 ? "" : `\nAdditional bounded context item ${sample}: ${"verify the declared scope before reporting evidence. ".repeat(sample)}`;
  if (role === "head") return [`You are the engineering Department Head for Goal goal-${sample}.`, "Contribution: own the bounded implementation.", "Urgency: normal.", "Context scope: confirmed contract, repository files.", "Budget effect: within envelope.", "Reason: phase 8 context baseline.", "Work only within this Goal and report evidence and blockers; do not perform unapproved critical actions.", suffix].join("\n");
  if (role === "worker") return `Assess the engineering risk before implementation and return a bounded evidence-backed result.${suffix}`;
  if (role === "encore-reviewer") return [
    "You are one of several fully independent Encore Council reviewers. You cannot see any other reviewer's answer.",
    "Question: Should the bounded local change proceed?",
    "Criteria: [safety] no prohibited effect; [evidence] evidence is durable and scoped.",
    "Evidence ids you may cite: evidence-a, evidence-b",
    'Reply with exactly one JSON object: {"verdict":"proceed"|"do_not_proceed"|"escalate","confidence":"low"|"medium"|"high","reasoning":string,"conditions":string[],"dissentNote":string|null,"citedEvidenceIds":string[]}', suffix,
  ].join("\n");
  if (role === "semantic-reviewer") return buildSemanticReviewPrompt({ claimText: `The bounded change is safe for sample ${sample}.`, criteria: [{ criterionId: "safety", description: "No prohibited effect is performed." }, { criterionId: "evidence", description: "The claim is supported by durable evidence." }], availableEvidenceIds: ["evidence-a", "evidence-b"] }) + suffix;
  return `Continue the operator conversation for Goal goal-${sample}; answer only within the confirmed project scope.${suffix}`;
}

async function capture(role: ContextRole, sample: number): Promise<CapturedContext> {
  const requests: GatewayTurnRequest[] = [];
  let resolveRequest: ((request: GatewayTurnRequest) => void) | undefined;
  const firstRequest = new Promise<GatewayTurnRequest>((resolve) => { resolveRequest = resolve; });
  let resolveTurnFinished: (() => void) | undefined;
  const turnFinished = new Promise<void>((resolve) => { resolveTurnFinished = resolve; });
  const gateway: ModelGatewayPort = {
    listModels: async () => [], admit: async () => binding,
    turn: (request) => {
      requests.push(request); resolveRequest?.(request);
      const result = { requestId: request.requestId, model, text: "bounded result", toolCalls: [], stopReason: "end_turn" as const, usage: { state: "unknown" } as const };
      return new Promise<typeof result>((resolve) => {
        setImmediate(() => {
          resolve(result);
          setImmediate(() => resolveTurnFinished?.());
        });
      });
    },
    cancel: async () => ({ state: "confirmed" }), recover: async () => "reconnected", close: async () => {},
  };
  const runtime = createMaestroAgentRuntime({ gateway, binding, tools: new ToolRegistry(), ...(role === "worker" || role === "team-lead-helper" ? { workerProfile: workerProfile(sample) } : {}), closeGateway: false });
  const rootAdmission: ExecutionAdmission = { context: context(role, sample), grant: grant(role, sample), modelPolicy: [modelRef], idempotencyKey: `${role}-command-${sample}` };
  if (role === "team-lead-helper") {
    const parent = await runtime.spawn({ name: `worker-parent-${sample}`, ...rootAdmission });
    const childGrant = grant(role, sample, rootAdmission.grant.grantId);
    const childRequest: SpawnRequest = { name: `helper-${sample}`, parent: parent.execution, prompt: `Return the bounded helper result with evidence and no widened scope.${sample === 0 ? "" : `\nAdditional helper context item ${sample}: ${"verify the declared scope before reporting evidence. ".repeat(sample)}`}`, context: rootAdmission.context, grant: childGrant, modelPolicy: [modelRef], idempotencyKey: `helper-command-${sample}` };
    await runtime.spawn(childRequest);
  } else {
    const spawned = await runtime.spawn({ name: `${role}-${sample}`, ...rootAdmission });
    await runtime.prompt(spawned.execution, promptFor(role, sample));
  }
  const request = requests[0] ?? await firstRequest;
  await turnFinished;
  await runtime.close?.();
  return { messages: request.messages, tools: request.tools };
}

export async function measureContextByRole(): Promise<readonly ContextSizeSummary[]> {
  const roles: readonly ContextRole[] = ["head", "worker", "team-lead-helper", "encore-reviewer", "semantic-reviewer", "conversation"];
  const result: ContextSizeSummary[] = [];
  for (const role of roles) {
    const contexts: CapturedContext[] = [];
    for (let sample = 0; sample < 10; sample += 1) contexts.push(await capture(role, sample));
    result.push(summary(role, contexts));
  }
  return result;
}
