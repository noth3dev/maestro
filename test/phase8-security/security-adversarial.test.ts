import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { AuthorizedEffectExecutor, evaluateAction, type ActionRequest, type AuthorityRepository } from "@maestro/authority";
import {
  assertEvidenceBundleIntegrity,
  assertValidMissionBundleSubstance,
  declareTaskDemand,
  deriveDiscordIncidentFingerprint,
  signDiscordSignal,
  verifyDiscordSignal,
  type DiscordSignal,
  type EvidenceBundle,
  type EnvironmentRecord,
  type MissionBundleSubstance,
} from "@maestro/domain";
import { createLocalRuntimeAdapter, type SpawnedProcess } from "../../packages/environment-adapter/src/runtime-adapter.js";
import { createReadOnlyHostRequestHandler } from "../../packages/agent-runtime/src/ipython-host.js";
import { signDeviceGrantEnvelope, verifyDeviceGrantEnvelope, type UnsignedDeviceGrantEnvelope } from "@maestro/device-agent";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

const baseRequest: ActionRequest = {
  commandId: "command-1", projectId: "project-1", actorId: "worker-1", goalId: "goal-1",
  action: "project.file.read", target: "workspace/readme.md", policyVersion: 1, budgetEffectCents: 0, controlEpoch: "1",
};

const requestArb = fc.record({
  prompt: fc.string(),
  target: fc.string(),
  action: fc.constantFrom("project.file.read", "project.file.edit", "project.test.run", "git.commit"),
});

function taskDemand() {
  const requirement = { level: 80, rationale: "security suite" };
  return declareTaskDemand({
    taskKinds: ["coding"],
    requirements: {
      coding: requirement, debugging: requirement, knowledge: requirement, reasoning: requirement,
      verification: requirement, "instruction-fidelity": requirement, "long-context": requirement,
      "tool-use": requirement, "refusal-calibration": requirement,
    },
    taskContractRef: "task-contract:security",
    headDecisionRef: "head-decision:security",
  });
}

function substance(overrides: Partial<MissionBundleSubstance> = {}): MissionBundleSubstance {
  return {
    role: "execution", profileRef: "profile-1", goalBrief: "bounded security test", taskDemand: taskDemand(),
    approvedModels: ["openai/model"], allowedSkills: ["coding"], allowedTools: ["read"], allowedPaths: ["packages"],
    environment: ["node24"], authorityBoundary: ["goal"], externalServiceBoundary: ["none"], dataBoundary: ["workspace"],
    costCeiling: "1 USD", timeCeiling: "1 hour", retryCeiling: 1, workerCeiling: 0, deliverable: "tests",
    evidenceRequirements: ["test output"], validationCriteria: ["tests pass"], terminationConditions: ["complete"], ...overrides,
  };
}

function signal(overrides: Partial<DiscordSignal> = {}): DiscordSignal {
  const value: DiscordSignal = {
    incidentFingerprint: "", firstObservedAt: "2026-01-01T00:00:01.000Z", lastObservedAt: "2026-01-01T00:00:02.000Z",
    severity: "warning", confidence: 0.9, affectedComponent: "control-plane", affectedVersion: "1.0.0",
    minimalReproductionEvidence: ["GET /health -> 503"], source: "health-probe", sourceFreshness: "2026-01-01T00:00:02.000Z",
    deduplicationRelationship: "new", discordHealthState: "healthy", ...overrides,
  };
  return { ...value, incidentFingerprint: deriveDiscordIncidentFingerprint(value) };
}

class FakeProcess extends EventEmitter implements SpawnedProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  kill(): boolean { return true; }
  finish(): void { this.emit("close", 0, null); }
}

function environment(root: string): EnvironmentRecord {
  return {
    environmentId: "environment-1", recipeVersion: 1, goalId: "goal-1", departmentId: "engineering", workerId: "worker-1",
    projectId: "project-1", missionId: "mission-1", type: "local_worktree", recipe: { runtime: "node", environmentAllowlist: ["NODE_ENV"] },
    resolvedInputs: { lockfile: "sha256:lock" }, capabilities: [{ name: "node", version: "24" }],
    boundaries: { network: ["none"], filesystem: [root], processes: ["node", process.execPath], browsers: [], devices: [] },
    secretsReferences: ["vault://project/token"], resources: { cpuMillis: 1000, memoryMb: 512, diskMb: 1024, processCount: 2, durationSeconds: 30 },
    expiresAt: "2030-01-01T00:00:00.000Z", state: "ready", setupLog: [], health: { status: "healthy", checkedAt: "2029-01-01T00:00:00.000Z", summary: "ok" },
    contentIdentity: "a".repeat(64), cleanup: { status: "not_scheduled", scheduledAt: null, completedAt: null, ownedResources: [], retainedEvidence: [], },
  };
}

const deviceKeys = generateKeyPairSync("ed25519");
const unsignedGrant = (overrides: Partial<UnsignedDeviceGrantEnvelope> = {}): UnsignedDeviceGrantEnvelope => ({
  version: 1, grantId: "grant-1", commandId: "command-1", goalId: "goal-1", projectId: "project-1", deviceId: "device-1",
  action: "project.file.read", target: "/workspace/readme.md", projectPath: "/workspace", application: "filesystem", dataResource: "/workspace/readme.md",
  networkTarget: "none", policyVersion: 1, goalFencingToken: "4", sequence: 1, issuedAt: "2020-01-01T00:00:00.000Z",
  expiresAt: "2099-01-01T00:00:00.000Z", nonce: "nonce-1", issuerKeyId: "issuer-1", ...overrides,
});

const emptyBundle = (): Omit<EvidenceBundle, "assembledAt"> => ({
  goalId: "goal-1", taskContract: null, council: null, departmentPlans: [], departmentPlanRevisions: [], workers: [],
  gitIntegration: {}, certifications: {}, metronomeFindings: [], metronomeChallenges: [], encoreRounds: [], budgetReservations: [],
  evidenceRecords: [], actualCosts: [], capabilityApprovals: [], capabilityRepetitionClaims: [], capabilityDecisionJournal: [],
  authorityRecords: [], authorityDecisions: [], councilBriefs: [], routingEvidence: [], nativeExecutionBindings: [],
  headParticipation: { participations: [], activationAttempts: [], activationEdges: [] },
});

describe("Plan 8 §S2 security adversarial suite", () => {
  it("derives effect classification from action identity, never prompt content", () => {
    fc.assert(fc.property(requestArb, ({ prompt, target, action }) => {
      const decision = evaluateAction({ ...baseRequest, action, target, commandId: prompt }, [], new Date("2029-01-01T00:00:00Z"));
      expect(decision.effect).not.toBe("allow");
      expect(decision.request.action).toBe(action);
    }));
  });

  it("rejects malicious repository path scopes at the Mission Bundle boundary", () => {
    expect(() => assertValidMissionBundleSubstance(substance({ allowedPaths: ["/etc", "../../secrets"] }))).toThrow();
  });

  it("denies every generated worker path escape before invoking an effect", async () => {
    const root = mkdtempSync(join(tmpdir(), "maestro-s2-path-"));
    try {
      await fc.assert(fc.asyncProperty(fc.stringMatching(/\.\.[/\\].+/), async (path) => {
        const effect = vi.fn(async () => undefined);
        const adapter = createLocalRuntimeAdapter(environment(root), { execute: async (_request, _effect) => { await _effect(); return { effect: "allow", reason: "exact_grant", classification: "ordinary", request: _request }; } }, { unsafeTestOnlyAllowUnisolatedLocalNetwork: true });
        await expect(adapter.start({ ...baseRequest, actorId: "worker-1", action: "project.test.run", target: path, argv: [process.execPath, "-e", "process.exit(0)"], cwd: root, pathScope: ["allowed"] } as never)).rejects.toThrow();
        expect(effect).not.toHaveBeenCalled();
      }));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("does not replay a stale command claim into a second effect", async () => {
    let calls = 0;
    const claimed = new Set<string>();
    const repository: AuthorityRepository = {
      load: async () => [{ recordId: "grant-1", kind: "grant", commandId: null, projectId: baseRequest.projectId, actorId: baseRequest.actorId, goalId: baseRequest.goalId, action: baseRequest.action, target: baseRequest.target, policyVersion: 1, budgetEffectCents: 0, expiresAt: new Date("2030-01-01") }],
      appendDecision: async () => undefined,
      recheckControl: async () => ({ effect: "allow" }),
      claimEffect: async (request) => { if (claimed.has(request.commandId)) return false; claimed.add(request.commandId); return true; },
    };
    const executor = new AuthorizedEffectExecutor(repository, () => new Date("2029-01-01"));
    await executor.execute(baseRequest, async () => { calls += 1; });
    await expect(executor.execute(baseRequest, async () => { calls += 1; })).resolves.toMatchObject({ reason: "already_executed" });
    expect(calls).toBe(1);
  });

  it("rejects every generated forged Discord signature", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 63 }), (index) => {
      const envelope = signDiscordSignal(signal(), "discord-secret", `nonce-${index}`, index + 1, "2026-01-01T00:00:03.000Z");
      const signature = envelope.signature.slice(0, index) + (envelope.signature[index] === "0" ? "1" : "0") + envelope.signature.slice(index + 1);
      expect(() => verifyDiscordSignal({ ...envelope, signature }, "discord-secret", Date.parse(envelope.issuedAt))).toThrow();
    }));
  });

  it("rejects a stolen device token before local execution", () => {
    const envelope = signDeviceGrantEnvelope(unsignedGrant(), deviceKeys.privateKey);
    expect(verifyDeviceGrantEnvelope({ ...envelope, target: "/etc/passwd" }, deviceKeys.publicKey)).toBe(false);
  });

  it("detects tampering in any evidence bundle content", () => {
    const bundle = emptyBundle();
    const expected = createHash("sha256").update(JSON.stringify(bundle)).digest("hex");
    expect(() => assertEvidenceBundleIntegrity({ ...bundle, goalId: "goal-2" }, expected)).toThrow();
  });

  it("keeps shell metacharacters as data and never invokes a shell", async () => {
    const root = mkdtempSync(join(tmpdir(), "maestro-s2-shell-"));
    try {
      const child = new FakeProcess();
      const spawned: string[] = [];
      const adapter = createLocalRuntimeAdapter(environment(root), { execute: async (request, effect) => { spawned.push(request.target); await effect(); return { effect: "allow", reason: "exact_grant", classification: "ordinary", request }; } }, { unsafeTestOnlyAllowUnisolatedLocalNetwork: true, spawn: (_executable, args) => { spawned.push(args.join(" ")); return child; } });
      const handle = await adapter.start({ ...baseRequest, action: "project.test.run", target: JSON.stringify([root, ["echo", "; touch pwned"]]), argv: ["node", "-e", "process.stdout.write('safe')", "; touch pwned"], cwd: root } as never);
      child.finish();
      await expect(handle.observe()).resolves.toMatchObject({ status: "succeeded" });
      expect(spawned.join(" ")).toContain("; touch pwned");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("redacts secret assignments and provider-shaped tokens before observation", async () => {
    const root = mkdtempSync(join(tmpdir(), "maestro-s2-secret-"));
    try {
      const child = new FakeProcess();
      const adapter = createLocalRuntimeAdapter(environment(root), { execute: async (request, effect) => { await effect(); return { effect: "allow", reason: "exact_grant", classification: "ordinary", request }; } }, { unsafeTestOnlyAllowUnisolatedLocalNetwork: true, spawn: () => child });
      const handle = await adapter.start({ ...baseRequest, action: "project.test.run", target: root, argv: ["node", "-e", "provider output"], cwd: root } as never);
      child.stdout.write("api_key=provider-secret\nsk-proj-1234567890abcdef");
      child.finish();
      const final = await handle.observe();
      expect(final.stdout).not.toContain("provider-secret");
      expect(final.stdout).not.toContain("sk-proj-1234567890abcdef");
      expect(final.stdout).toContain("[REDACTED]");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("keeps the IPython host registry and path/data boundary fail-closed", async () => {
    const readFile = vi.fn(async () => ({ state: "ok" as const, dataClass: "workspace" as const, content: "safe" }));
    const binding = { sessionId: "session-1", commandId: "command-1", toolCallId: "tool-1", operatorId: "worker-1", projectId: "project-1", goalId: "goal-1", pathScope: ["/workspace/project"], outboundDataClasses: ["workspace"] as const, authorityPolicyVersion: 1, controlEpoch: "1", budgetEffectCents: 0 };
    const handler = createReadOnlyHostRequestHandler({ binding, gateway: { readFile, gitRevision: async () => ({ state: "ok", dataClass: "workspace", content: "abc" }), } });
    await expect(handler({ requestId: "r1", hostRequestId: "h1", method: "read_file", payload: { path: "../secret" } })).rejects.toThrow(/outside/);
    await expect(handler({ requestId: "r2", hostRequestId: "h2", method: "run_shell", payload: {} })).rejects.toThrow(/not allowed/);
    await expect(handler({ requestId: "r3", hostRequestId: "h3", method: "read_file", payload: { path: "README.md" } }, { ...binding, goalId: "other-goal" })).rejects.toThrow(/identity changed/);
    expect(readFile).not.toHaveBeenCalled();
  });
});
