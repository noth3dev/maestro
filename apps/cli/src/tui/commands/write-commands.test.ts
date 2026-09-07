import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@maestro/api-client";
import { executeWriteCommand } from "./write-commands.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const commandId = "33333333-3333-4333-8333-333333333333";
const goal = { goalId, projectId, state: "pausing" as const, version: 2 };
const contractSubstance = {
  desiredOutcome: "Ship",
  userVisibleBehavior: ["Users can ship"], successCriteria: ["Tests pass"], liveEvidence: ["CI"], scope: ["CLI"], nonGoals: ["Unrelated work"],
  priorities: ["Safety"], acceptableTradeoffs: ["Time"], constraints: ["Bounded"], knownEdgeCases: ["Empty input"],
  project: { projectId, repository: "repo", immutableBaseRevision: "base", dataBoundary: "local" },
  evidenceReferences: ["evidence-1"], approvedPreviewReferences: [], expectedGroups: ["product"], expectedDepartments: ["engineering"],
  criticalActionExpectations: ["none"], forbiddenEffects: ["production"], environmentAssumptions: ["node"], externalServiceAssumptions: ["none"],
  budget: { ceiling: "1", reportingExpectations: ["cost"], stoppingConditions: ["over budget"] },
};

function api(): ApiClient {
  return {
    pauseGoal: vi.fn().mockResolvedValue(goal),
    emergencyStopGoal: vi.fn().mockResolvedValue({ ...goal, state: "stopped" as const }),
    createGoal: vi.fn().mockResolvedValue({ ...goal, state: "draft" as const }),
    createTaskContract: vi.fn(),
    scanMetronome: vi.fn().mockResolvedValue({ findings: [] }),
    raiseMetronomeChallenge: vi.fn(),
    provisionProjectAccess: vi.fn(),
    requestCriticalAction: vi.fn().mockResolvedValue({ goalId, effect: "allow", reason: "approved by policy", classification: "ordinary" }),
    approveAndRunCriticalAction: vi.fn().mockResolvedValue({ effect: "allow", reason: "approved" }),
    certifyConditionalWorker: vi.fn().mockResolvedValue({ workerId: "worker-1", status: "certified" }),
    spawnWorker: vi.fn().mockResolvedValue({ workerId: "worker-1", status: "running" }),
    runEncoreReview: vi.fn().mockResolvedValue({ roundId: "round-1" }),
  } as unknown as ApiClient;
}

describe("TUI write commands", () => {
  it("passes stable command identity to a safe Goal mutation", async () => {
    const client = api();
    await executeWriteCommand({ client, projectId, confirm: vi.fn() }, { name: "goal", action: "pause", options: { "goal-id": goalId, "expected-version": "1", "command-id": commandId } });
    expect(client.pauseGoal).toHaveBeenCalledWith(goalId, { projectId, expectedVersion: 1 }, commandId);
  });

  it("uses the selected session Goal when a Goal-scoped write omits --goal-id", async () => {
    const client = api();
    await executeWriteCommand({ client, projectId, goalId, confirm: vi.fn() }, { name: "goal", action: "pause", options: { "expected-version": "1", "command-id": commandId } });
    expect(client.pauseGoal).toHaveBeenCalledWith(goalId, { projectId, expectedVersion: 1 }, commandId);
  });

  it("requires explicit confirmation before the server-authorized fail-safe emergency stop", async () => {
    const client = api();
    const confirm = vi.fn().mockResolvedValue("cancelled" as const);
    await expect(executeWriteCommand({ client, projectId, confirm }, { name: "goal", action: "emergency-stop", options: { "goal-id": goalId, "expected-version": "1", "command-id": commandId } })).resolves.toEqual({ title: "Cancelled", lines: ["No mutation was sent."] });
    expect(confirm).toHaveBeenCalledOnce();
    expect(client.emergencyStopGoal).not.toHaveBeenCalled();
  });

  it("runs the fail-safe emergency stop only after explicit confirmation", async () => {
    const client = api();
    const confirm = vi.fn().mockResolvedValue("approved" as const);
    await expect(executeWriteCommand({ client, projectId, confirm }, { name: "goal", action: "emergency-stop", options: { "goal-id": goalId, "expected-version": "1", "command-id": commandId } })).resolves.toEqual({ title: "Goal", lines: [`Goal ${goal.goalId} · stopped · v${goal.version}`] });
    expect(confirm).toHaveBeenCalledOnce();
    expect(client.emergencyStopGoal).toHaveBeenCalledWith(goalId, { projectId, expectedVersion: 1 }, commandId);
  });

  it("never treats a local confirmation as durable approval for project access changes", async () => {
    const client = api();
    const confirm = vi.fn().mockResolvedValue("approved" as const);
    await expect(executeWriteCommand({ client, projectId, confirm }, { name: "admin", action: "project-access", options: { "operator-id": "operator-1", "roles-json": "[]" } })).resolves.toEqual({
      title: "Unavailable",
      lines: ["Critical action requires the durable Control Plane approval path; no mutation was sent."],
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(client.provisionProjectAccess).not.toHaveBeenCalled();
  });

  it("routes critical-action requests through the typed Control Plane client", async () => {
    const client = api();
    await expect(executeWriteCommand({ client, projectId, confirm: vi.fn() }, { name: "critical-action", action: "request", options: { "goal-id": goalId, action: "deploy", target: "staging", "policy-version": "2", "budget-effect-cents": "0", "command-id": commandId } })).resolves.toEqual({ title: "Critical action", lines: ["allow · ordinary · approved by policy"] });
    expect(client.requestCriticalAction).toHaveBeenCalledWith(goalId, { projectId, action: "deploy", target: "staging", policyVersion: 2, budgetEffectCents: 0 }, commandId);
  });

  it("accepts the existing critical-action CLI spelling and reaches the durable approval endpoint", async () => {
    const client = api();
    const confirm = vi.fn().mockResolvedValue("approved" as const);
    const result = await executeWriteCommand({ client, projectId, confirm }, { name: "critical-action", action: "approve-and-run", options: {
      "goal-id": goalId, action: "git.remote.push", target: "origin/main", version: "1", "budget-effect-cents": "0", "expires-at": "2030-01-01T00:00:00.000Z", "command-id": commandId,
    } });
    expect(result.title).toBe("Critical action");
    expect(client.approveAndRunCriticalAction).toHaveBeenCalledWith(goalId, { projectId, action: "git.remote.push", target: "origin/main", policyVersion: 1, budgetEffectCents: 0, expiresAt: "2030-01-01T00:00:00.000Z" }, commandId);
  });

  it("keeps the workspace project binding when certifying a conditional Worker", async () => {
    const client = api();
    await executeWriteCommand({ client, projectId, confirm: vi.fn() }, { name: "worker", action: "certify-conditional", options: {
      "worker-id": "worker-1", kind: "security", "certification-json": JSON.stringify({ projectId: "other-project", certifyingDepartmentId: "security", substance: { verdict: "passed", findings: [], testEvidenceIds: [] } }), "command-id": commandId,
    } });
    expect(client.certifyConditionalWorker).toHaveBeenCalledWith("worker-1", "security", { projectId, certifyingDepartmentId: "security", substance: { verdict: "passed", findings: [], testEvidenceIds: [] } }, commandId);
  });

  it("keeps the workspace project binding when spawning a Worker", async () => {
    const client = api();
    await executeWriteCommand({ client, projectId, confirm: vi.fn() }, { name: "worker", action: "spawn", options: {
      "council-id": "council-1", "department-id": "product", "worker-json": JSON.stringify({ projectId: "other-project", planVersion: 1, itemId: "scout-1" }), "command-id": commandId,
    } });
    expect(client.spawnWorker).toHaveBeenCalledWith("council-1", "product", { projectId, planVersion: 1, itemId: "scout-1" }, commandId);
  });

  it("keeps the workspace project binding when starting an Encore review", async () => {
    const client = api();
    await executeWriteCommand({ client, projectId, confirm: vi.fn() }, { name: "encore", action: "review", options: {
      "goal-id": goalId, "review-json": JSON.stringify({ projectId: "other-project", question: "Should we proceed?", criteria: [{ criterionId: "safety", description: "Preserve safety" }], evidenceIds: [], reviewerCount: 2 }), "command-id": commandId,
    } });
    expect(client.runEncoreReview).toHaveBeenCalledWith(goalId, { projectId, question: "Should we proceed?", criteria: [{ criterionId: "safety", description: "Preserve safety" }], evidenceIds: [], reviewerCount: 2 }, commandId);
  });

  it("routes Task Contract intake through the typed client", async () => {
    const client = api();
    vi.mocked(client.createTaskContract).mockResolvedValue({ contractId: "44444444-4444-4444-8444-444444444444", launchState: "awaiting_confirmation" } as never);
    const result = await executeWriteCommand({ client, projectId, confirm: vi.fn() }, { name: "task-contract", action: "create", options: { "contract-id": commandId, "substance-json": JSON.stringify(contractSubstance) } });
    expect(result.title).toBe("Task Contract");
    expect(client.createTaskContract).toHaveBeenCalledWith({ projectId, substance: contractSubstance }, expect.any(String));
  });

  it("rejects malformed structured JSON before invoking the typed client", async () => {
    const client = api();
    await expect(executeWriteCommand({ client, projectId, confirm: vi.fn() }, { name: "worker", action: "spawn", options: {
      "council-id": "council-1", "department-id": "product", "worker-json": JSON.stringify({ planVersion: "one", itemId: "scout-1" }), "command-id": commandId,
    } })).resolves.toEqual({ title: "Unavailable", lines: ["--worker-json does not match the expected input shape"] });
    expect(client.spawnWorker).not.toHaveBeenCalled();
  });

  it("routes Metronome scan as an idempotent write command", async () => {
    const client = api();
    await expect(executeWriteCommand({ client, projectId, confirm: vi.fn() }, { name: "metronome", action: "scan", options: { "goal-id": goalId, "command-id": commandId } })).resolves.toEqual({ title: "Metronome", lines: ["findings: 0"] });
    expect(client.scanMetronome).toHaveBeenCalledWith(goalId, { projectId }, commandId);
  });

  it("accepts array JSON for Metronome challenge references", async () => {
    const client = api();
    vi.mocked(client.raiseMetronomeChallenge).mockResolvedValue({ challengeId: "44444444-4444-4444-8444-444444444444", status: "open" } as never);
    const result = await executeWriteCommand({ client, projectId, confirm: vi.fn() }, { name: "metronome", action: "challenge", options: { "goal-id": goalId, reason: "drift", "finding-ids": "[]", "evidence-references": "[]", "command-id": commandId } });
    expect(result.title).toBe("Metronome");
    expect(client.raiseMetronomeChallenge).toHaveBeenCalledWith(goalId, { projectId, reason: "drift", findingIds: [], evidenceReferences: [] }, commandId);
  });

  it("replays with the caller supplied command ID instead of replacing it", async () => {
    const client = api();
    const command = { name: "goal", action: "pause", options: { "goal-id": goalId, "expected-version": "1", "command-id": commandId } } as const;
    await executeWriteCommand({ client, projectId, confirm: vi.fn() }, command);
    await executeWriteCommand({ client, projectId, confirm: vi.fn() }, command);
    expect(vi.mocked(client.pauseGoal).mock.calls.map((call) => call[2])).toEqual([commandId, commandId]);
  });
});
