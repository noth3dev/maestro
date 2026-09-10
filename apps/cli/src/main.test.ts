import { describe, expect, it, vi } from "vitest";
import { executeCli, shouldRunAsMain } from "./main.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const commandId = "33333333-3333-4333-8333-333333333333";
const env = { MAESTRO_API_URL: "https://maestro.test", MAESTRO_API_TOKEN: "top-secret" };

function output() {
  const lines: string[] = [];
  return { lines, write: (line: string) => { lines.push(line); } };
}

describe("executeCli", () => {
  it("shows help and version before requiring API credentials", async () => {
    const stdout = output();
    const stderr = output();
    expect(await executeCli(["--help"], {}, { stdout: stdout.write, stderr: stderr.write })).toBe(0);
    expect(stdout.lines[0]).toContain("MAESTRO_API_URL");
    expect(stdout.lines[0]).toContain("goal create");
    expect(stdout.lines[0]).toContain("metronome-challenges list");
    expect(stdout.lines[0]).toContain("encore-council list");
    expect(stdout.lines[0]).toContain("concertmaster-report get");
    expect(stdout.lines[0]).toContain("evidence dump");
    expect(stderr.lines).toEqual([]);
    stdout.lines.length = 0;
    expect(await executeCli(["--version"], {}, { stdout: stdout.write, stderr: stderr.write })).toBe(0);
    expect(stdout.lines[0]).toMatch(/^maestro /);
  });

  it("reads provider login secrets through the hidden-input boundary, not argv", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ bindingId: "credential-1", providerId: "openai", authMode: "api-key", accountRef: "openai-operator", configuredAt: "2025-01-01T00:00:00.000Z" }), { status: 200 }));
    const stdout = output();
    const stderr = output();
    const readSecret = vi.fn(async () => "sk-test");
    await expect(executeCli(["login", "openai", "--json"], env, { fetch, readSecret, stdout: stdout.write, stderr: stderr.write })).resolves.toBe(0);
    expect(readSecret).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith("https://maestro.test/v1/provider-credentials", expect.objectContaining({ body: JSON.stringify({ providerId: "openai", authMode: "api-key", secret: "sk-test" }) }));
    expect(stdout.lines[0]).not.toContain("sk-test");
    expect(stderr.lines).toEqual([]);
  });

  it("opens the approved account login in a browser and waits for completion", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ providerId: "openai-codex", loginId: "login-1", authUrl: "https://chatgpt.com/login" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ providerId: "openai-codex", loginId: "login-1", state: "succeeded" }), { status: 200 }));
    const stdout = output();
    const openExternalUrl = vi.fn(async () => {});
    await expect(executeCli(["login", "openai-codex"], env, { fetch, openExternalUrl, stdout: stdout.write, stderr: output().write })).resolves.toBe(0);
    expect(openExternalUrl).toHaveBeenCalledWith("https://chatgpt.com/login");
    expect(stdout.lines.join(" ")).toContain("Account login complete");
    expect(stdout.lines.join(" ")).not.toContain("access_token");
  });

  it("creates a goal from environment-only connection settings and prints JSON", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ goalId, projectId, state: "draft", version: 0 }), { status: 201 }));
    const stdout = output();
    const stderr = output();

    const exitCode = await executeCli(["goal", "create", "--project-id", projectId, "--command-id", commandId, "--json"], env, { fetch, stdout: stdout.write, stderr: stderr.write });

    expect(exitCode).toBe(0);
    expect(stdout.lines).toEqual([`${JSON.stringify({ goalId, projectId, state: "draft", version: 0 })}
`]);
    expect(stderr.lines).toEqual([]);
    expect(fetch).toHaveBeenCalledWith("https://maestro.test/v1/goals", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer top-secret", "idempotency-key": commandId }) }));
  });

  it("can create a Goal bound to a launched Task Contract", async () => {
    const contractId = "55555555-5555-4555-8555-555555555555";
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ goalId, projectId, contractId, state: "draft", version: 1 }), { status: 201 }));
    const stdout = output();
    await expect(executeCli(["goal", "create", "--project-id", projectId, "--contract-id", contractId, "--command-id", commandId, "--json"], env, { fetch, stdout: stdout.write, stderr: output().write })).resolves.toBe(0);
    expect(fetch).toHaveBeenCalledWith("https://maestro.test/v1/goals", expect.objectContaining({ body: JSON.stringify({ projectId, contractId }) }));
  });

  it("gets and transitions a goal using parsed command arguments", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ goalId, projectId, state: "draft", version: 0 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ goalId, projectId, state: "ready_for_confirmation", version: 1 }), { status: 200 }));
    const stdout = output();

    await expect(executeCli(["goal", "get", "--goal-id", goalId, "--project-id", projectId], env, { fetch, stdout: stdout.write, stderr: output().write })).resolves.toBe(0);
    await expect(executeCli(["goal", "transition", "--goal-id", goalId, "--project-id", projectId, "--expected-version", "0", "--to", "ready_for_confirmation", "--command-id", commandId], env, { fetch, stdout: stdout.write, stderr: output().write })).resolves.toBe(0);

    expect(fetch).toHaveBeenNthCalledWith(1, `https://maestro.test/v1/goals/${goalId}?projectId=${projectId}`, expect.anything());
    expect(fetch).toHaveBeenNthCalledWith(2, `https://maestro.test/v1/goals/${goalId}/transitions`, expect.objectContaining({ method: "POST", body: JSON.stringify({ projectId, expectedVersion: 0, to: "ready_for_confirmation" }) }));
    expect(stdout.lines).toEqual([`Goal ${goalId}: draft (version 0)\n`, `Goal ${goalId}: ready_for_confirmation (version 1)\n`]);
  });

  it("runs project-bound Goal control operations with idempotency keys", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ goalId, projectId, state: "pausing", version: 1 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ goalId, projectId, state: "stopping", version: 2 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ goalId, projectId, state: "resuming", version: 3 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ goalId, projectId, state: "stopped", version: 4 }), { status: 200 }));
    const stdout = output();
    const stderr = output();
    for (const [action, expectedState, actionCommandId] of [["pause", "pausing", commandId], ["stop", "stopping", "44444444-4444-4444-8444-444444444444"], ["resume", "resuming", "55555555-5555-4555-8555-555555555555"], ["emergency-stop", "stopped", "66666666-6666-4666-8666-666666666666"]] as const) {
      await expect(executeCli(["goal", action, "--goal-id", goalId, "--project-id", projectId, "--expected-version", "0", "--command-id", actionCommandId, "--json"], env, { fetch, stdout: stdout.write, stderr: stderr.write })).resolves.toBe(0);
      expect(JSON.parse(stdout.lines.at(-1)!)).toMatchObject({ state: expectedState });
    }
    expect(fetch).toHaveBeenNthCalledWith(1, `https://maestro.test/v1/goals/${goalId}/pause`, expect.objectContaining({ method: "POST", body: JSON.stringify({ projectId, expectedVersion: 0 }) }));
    expect(fetch).toHaveBeenNthCalledWith(4, `https://maestro.test/v1/goals/${goalId}/emergency-stop`, expect.objectContaining({ method: "POST" }));
    expect(stderr.lines).toEqual([]);
  });

  it("lists Goals and shows the budget summary with project binding", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ goals: [{ goalId, projectId, state: "draft", version: 0 }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ goalId, projectId, budgetCents: 10, reservedCents: 4, costCents: 3 }), { status: 200 }));
    const stdout = output();
    expect(await executeCli(["goals", "list", "--project-id", projectId, "--json"], env, { fetch, stdout: stdout.write, stderr: output().write })).toBe(0);
    expect(await executeCli(["budget", "get", "--goal-id", goalId, "--project-id", projectId, "--json"], env, { fetch, stdout: stdout.write, stderr: output().write })).toBe(0);
    expect(JSON.parse(stdout.lines[0]!)).toEqual({ goals: [{ goalId, projectId, state: "draft", version: 0 }] });
    expect(JSON.parse(stdout.lines[1]!)).toEqual({ goalId, projectId, budgetCents: 10, reservedCents: 4, costCents: 3 });
  });

  it("lists events in readable form", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ events: [], nextCursor: "0" }), { status: 200 }));
    const stdout = output();

    const exitCode = await executeCli(["events", "list", "--project-id", projectId], env, { fetch, stdout: stdout.write, stderr: output().write });

    expect(exitCode).toBe(0);
    expect(stdout.lines).toEqual(["Events: 0 (next cursor: 0)\n"]);
  });

  it("rejects missing environment settings without echoing a token", async () => {
    const stderr = output();
    const exitCode = await executeCli(["goal", "get", "--goal-id", goalId, "--project-id", projectId], { MAESTRO_API_TOKEN: "top-secret" }, { fetch: vi.fn(), stdout: output().write, stderr: stderr.write });

    expect(exitCode).toBe(2);
    expect(stderr.lines.join("")).toContain("MAESTRO_API_URL");
    expect(stderr.lines.join("")).not.toContain("top-secret");
  });


  it("starts the interactive TUI for a bare invocation before requiring API credentials", async () => {
    const stdout = output();
    const stderr = output();
    const startTui = vi.fn().mockResolvedValue(0);

    await expect(executeCli([], {}, { stdout: stdout.write, stderr: stderr.write, startTui })).resolves.toBe(0);
    expect(startTui).toHaveBeenCalledWith(expect.any(String), {}, expect.objectContaining({ stdout: stdout.write }));
    expect(stderr.lines).toEqual([]);
  });
});

it("reads Metronome challenges through the parity command", async () => { const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({challenges:[]}),{status:200})); const stdout=output(); const stderr=output(); await expect(executeCli(["metronome-challenges","list","--goal-id",goalId,"--project-id",projectId,"--json"],env,{fetch,stdout:stdout.write,stderr:stderr.write})).resolves.toBe(0); expect(JSON.parse(stdout.lines[0]!)).toEqual({challenges:[]}); expect(stderr.lines).toEqual([]); });


it("drives the Task Contract intake lifecycle through CLI commands", async () => {
  const contractId = "55555555-5555-4555-8555-555555555555";
  const substance = {
    desiredOutcome: "Ship", userVisibleBehavior: ["Works"], successCriteria: ["Passes"], liveEvidence: ["Live"], scope: ["Feature"], nonGoals: ["Other"], priorities: ["Safety"], acceptableTradeoffs: ["Time"], constraints: ["Local"], knownEdgeCases: ["Retry"],
    project: { projectId, repository: "/repo", immutableBaseRevision: "abc", dataBoundary: "repo" }, evidenceReferences: ["spec"], approvedPreviewReferences: [], expectedGroups: ["Product"], expectedDepartments: ["Product"], criticalActionExpectations: ["Approval"], forbiddenEffects: ["Deploy"], environmentAssumptions: ["DB"], externalServiceAssumptions: ["None"], budget: { ceiling: "10", reportingExpectations: ["Report"], stoppingConditions: ["Stop"] },
  };
  const contract = { contractId, schemaVersion: 1, version: 1, ...substance, decisionHistory: [], contentHash: "a".repeat(64), launchState: "awaiting_confirmation" };
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(contract), { status: 201 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ roles: ["conversation-lead"] }), { status: 200 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ...contract, launchState: "launched" }), { status: 200 }));
  const stdout = output();
  const args = ["task-contract", "create", "--project-id", projectId, "--contract-id", contractId, "--substance-json", JSON.stringify(substance), "--json"];
  expect(await executeCli(args, env, { fetch, stdout: stdout.write, stderr: output().write })).toBe(0);
  expect(await executeCli(["task-contract", "select-roles", "--contract-id", contractId, "--project-id", projectId, "--outside-evidence", "--json"], env, { fetch, stdout: stdout.write, stderr: output().write })).toBe(0);
  expect(await executeCli(["task-contract", "confirm", "--contract-id", contractId, "--project-id", projectId, "--version", "1", "--content-hash", contract.contentHash], env, { fetch, stdout: stdout.write, stderr: output().write })).toBe(0);
  expect(await executeCli(["task-contract", "launch", "--contract-id", contractId, "--project-id", projectId, "--json"], env, { fetch, stdout: stdout.write, stderr: output().write })).toBe(0);
  expect(JSON.parse(stdout.lines[0]!)).toEqual(contract);
  expect(fetch).toHaveBeenNthCalledWith(1, "https://maestro.test/v1/task-contracts", expect.anything());
});


it("requests a critical action through the CLI", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ goalId, effect: "allow", reason: "policy allows", classification: "ordinary", recordId: commandId }), { status: 200 }));
  const stdout = output();
  const exitCode = await executeCli([
    "critical-action", "request", "--goal-id", goalId, "--project-id", projectId,
    "--action", "deploy", "--target", "staging", "--version", "2",
    "--budget-effect-cents", "0", "--command-id", commandId, "--json",
  ], env, { fetch, stdout: stdout.write, stderr: output().write });
  expect(exitCode).toBe(0);
  expect(JSON.parse(stdout.lines[0]!)).toMatchObject({ effect: "allow", recordId: commandId });
  expect(fetch).toHaveBeenCalledWith(`https://maestro.test/v1/goals/${goalId}/critical-actions`, expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "idempotency-key": commandId }) }));
});

it("approves and runs a critical action through the CLI", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ goalId, effect: "allow", reason: "exact_approval", classification: "critical", recordId: commandId }), { status: 200 }));
  const stdout = output();
  const exitCode = await executeCli([
    "critical-action", "approve-and-run", "--goal-id", goalId, "--project-id", projectId,
    "--action", "git.remote.push", "--target", "origin/main", "--version", "1",
    "--budget-effect-cents", "0", "--expires-at", "2030-01-01T00:00:00.000Z",
    "--command-id", commandId, "--json",
  ], env, { fetch, stdout: stdout.write, stderr: output().write });
  expect(exitCode).toBe(0);
  expect(JSON.parse(stdout.lines[0]!)).toMatchObject({ effect: "allow", recordId: commandId });
  expect(fetch).toHaveBeenCalledWith(`https://maestro.test/v1/goals/${goalId}/critical-actions/approve-and-run`, expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "idempotency-key": commandId }) }));
});


it("activates a Head through the CLI", async () => {
  const input = { projectId, departmentId: "product", requestedContribution: "implement", urgency: "normal", contextScope: ["contract"], budgetEffect: "none", reason: "launch" };
  const result = { goalId, departmentId: "product", headRoleId: "head:product", contractId: null, contextId: null, status: "active", activeSessionRef: "execution-1" };
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(result), { status: 200 }));
  const stdout = output();
  const commandId = "33333333-3333-4333-8333-333333333333";
  expect(await executeCli(["head", "activate", "--goal-id", goalId, "--activation-json", JSON.stringify(input), "--command-id", commandId, "--json"], env, { fetch, stdout: stdout.write, stderr: output().write })).toBe(0);
  expect(JSON.parse(stdout.lines[0]!)).toEqual(result);
  expect(fetch).toHaveBeenCalledWith(`https://maestro.test/v1/goals/${goalId}/head-participations`, expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "idempotency-key": commandId }) }));
});


it("creates a Head Council through the CLI", async () => {
  const contractId = "55555555-5555-4555-8555-555555555555";
  const council = { councilId: "44444444-4444-4444-8444-444444444444", goalId, contractId, briefDeadline: "2030-01-01T00:00:00.000Z", state: "collecting", noNewEvidenceStreak: 0, decisionPacket: null, snapshotHash: "a".repeat(64), snapshot: {} };
  const input = { projectId, contractId, briefDeadline: council.briefDeadline, evidence: {} };
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(council), { status: 201 }));
  const stdout = output();
  expect(await executeCli(["council", "create", "--goal-id", goalId, "--council-json", JSON.stringify(input), "--command-id", commandId, "--json"], env, { fetch, stdout: stdout.write, stderr: output().write })).toBe(0);
  expect(JSON.parse(stdout.lines[0]!)).toEqual(council);
});


it("provisions exact project roles through the authenticated admin command", async () => {
  const operatorId = "66666666-6666-4666-8666-666666111111";
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ operatorId, projectId, roles: ["concertmaster", "head-product"] }), { status: 200 }));
  const stdout = output();
  expect(await executeCli(["admin", "project-access", "--operator-id", operatorId, "--project-id", projectId, "--roles-json", JSON.stringify(["concertmaster", "head-product"]), "--json"], env, { fetch, stdout: stdout.write, stderr: output().write })).toBe(0);
  expect(JSON.parse(stdout.lines[0]!)).toEqual({ operatorId, projectId, roles: ["concertmaster", "head-product"] });
  expect(fetch).toHaveBeenCalledWith("https://maestro.test/v1/admin/project-access", expect.objectContaining({ method: "POST" }));
});


it("dumps the evidence bundle, certifications, and report as one artifact", async () => {
  const bundle = { bundleId: "77777777-7777-4777-8777-777777777777", goalId, hash: "a".repeat(64), content: { goalId, assembledAt: "2030-01-01T00:00:00.000Z" } };
  const certifications = { certifications: [] };
  const report = { reportId: "88888888-8888-4888-8888-888888888888", goalId, success: true, blockers: [], ceoRequest: "Ship", whatChanged: "A safe change", userVisibleBehaviorPassed: true, participatingDepartments: [], keyDecisions: [], dissent: [], independentValidation: [], costCents: 0, budgetCents: 10, incidents: [], knownLimitations: [], criticalActionAwaitingApproval: false, evidenceBundleId: bundle.bundleId };
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(bundle), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(certifications), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(report), { status: 200 }));
  const stdout = output();
  await expect(executeCli(["evidence", "dump", "--goal-id", goalId, "--project-id", projectId, "--json"], env, { fetch, stdout: stdout.write, stderr: output().write })).resolves.toBe(0);
  expect(JSON.parse(stdout.lines[0]!)).toEqual({ bundle, certifications, report });
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(fetch).toHaveBeenNthCalledWith(1, `https://maestro.test/v1/goals/${goalId}/evidence-bundle?projectId=${projectId}`, expect.objectContaining({ headers: expect.anything() }));
  expect(fetch).toHaveBeenNthCalledWith(2, `https://maestro.test/v1/goals/${goalId}/certifications?projectId=${projectId}`, expect.objectContaining({ headers: expect.anything() }));
  expect(fetch).toHaveBeenNthCalledWith(3, `https://maestro.test/v1/goals/${goalId}/concertmaster-report?projectId=${projectId}`, expect.objectContaining({ headers: expect.anything() }));
  for (const [, options] of fetch.mock.calls) expect(options?.method).toBeUndefined();
});

it("fails closed when the report points to a different evidence bundle", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ bundleId: "77777777-7777-4777-8777-777777777777", goalId, hash: "a".repeat(64), content: { goalId } }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ certifications: [] }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ reportId: "88888888-8888-4888-8888-888888888888", goalId, success: true, blockers: [], ceoRequest: "Ship", whatChanged: "A safe change", userVisibleBehaviorPassed: true, participatingDepartments: [], keyDecisions: [], dissent: [], independentValidation: [], costCents: 0, budgetCents: 10, incidents: [], knownLimitations: [], criticalActionAwaitingApproval: false, evidenceBundleId: "99999999-9999-4999-8999-999999999999" }), { status: 200 }));
  const stderr = output();
  await expect(executeCli(["evidence", "dump", "--goal-id", goalId, "--project-id", projectId, "--json"], env, { fetch, stdout: output().write, stderr: stderr.write })).resolves.toBe(2);
  expect(stderr.lines[0]).toContain("identity mismatch");
});

describe("CLI entrypoint detection", () => {
  it("recognizes a symlinked executable by its resolved path", () => {
    const modulePath = "/work/apps/cli/dist/main.js";
    expect(shouldRunAsMain(`file://${modulePath}`, "/work/node_modules/.bin/maestro", () => modulePath)).toBe(true);
  });
});


describe("native conversation commands", () => {
  it("accepts the singular model alias and defaults to list", async () => {
    const models = [{ identity: { provider: "openai", id: "gpt-5" }, capabilities: ["text"], authModes: ["api-key"], dataPolicy: { allowedDataClasses: ["public"], retention: "provider-policy", trainsOnCustomerData: false, regions: ["US"] } }];
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(models), { status: 200 }));
    const stdout = output();
    await expect(executeCli(["model", "--json"], env, { fetch, stdout: stdout.write, stderr: output().write })).resolves.toBe(0);
    expect(JSON.parse(stdout.lines[0]!)).toEqual(models);
    expect(fetch).toHaveBeenCalledWith("https://maestro.test/v1/models", expect.anything());
  });

  it("lists models and runs a conversation turn through the API", async () => {
    const conversationId = "44444444-4444-4444-8444-444444444444";
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ identity: { provider: "openai", id: "gpt-5" }, capabilities: ["text"], authModes: ["api-key"], dataPolicy: { allowedDataClasses: ["public"], retention: "provider-policy", trainsOnCustomerData: false, regions: ["US"] } }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversationId, projectId, goalId, model: "openai/gpt-5", status: "active", version: 1 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversation: { conversationId, projectId, goalId, model: "openai/gpt-5", status: "succeeded", version: 2 }, turn: { turnId: "55555555-5555-4555-8555-555555555555", conversationId, role: "assistant", content: "hello", status: "completed", cursor: "2", createdAt: "2030-01-01T00:00:00.000Z" } }), { status: 200 }));
    const stdout = output(); const stderr = output();
    expect(await executeCli(["models", "list", "--json"], env, { fetch, stdout: stdout.write, stderr: stderr.write })).toBe(0);
    expect(await executeCli(["conversation", "create", "--project-id", projectId, "--goal-id", goalId, "--model", "openai/gpt-5", "--json"], env, { fetch, stdout: stdout.write, stderr: stderr.write })).toBe(0);
    expect(await executeCli(["conversation", "turn", "--conversation-id", conversationId, "--project-id", projectId, "--text", "hi", "--json"], env, { fetch, stdout: stdout.write, stderr: stderr.write })).toBe(0);
    expect(stderr.lines).toEqual([]);
  });
});

describe("release capability commands", () => {
  it("selects full-access mode and captures evidence through the CLI", async () => {
    const session = { sessionId: goalId, capabilityKind: "ipython", projectId, goalId, fullAccessMode: "skip_intermediate_approvals", selectedBy: "operator-1", selectedAt: "2025-01-01T00:00:00.000Z" };
    const evidence = { evidenceId: "44444444-4444-4444-8444-444444444444", context: { correlationId: commandId, commandId, projectId, goalId, actorId: "operator-1" }, sha256: "a".repeat(64), byteLength: 4, kind: "test-result", mediaType: "text/plain", createdAt: "2025-01-01T00:00:00.000Z", retention: "project_lifetime" };
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(session), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(evidence), { status: 200 }));
    const stdout = output(); const stderr = output();
    await expect(executeCli(["capability", "select-full-access-mode", "--goal-id", goalId, "--project-id", projectId, "--capability-kind", "ipython", "--session-id", goalId, "--full-access-mode", "skip_intermediate_approvals", "--json"], env, { fetch, stdout: stdout.write, stderr: stderr.write })).resolves.toBe(0);
    await expect(executeCli(["evidence", "capture", "--goal-id", goalId, "--project-id", projectId, "--correlation-id", commandId, "--command-id", commandId, "--kind", "test-result", "--media-type", "text/plain", "--content-base64", Buffer.from("test").toString("base64"), "--json"], env, { fetch, stdout: stdout.write, stderr: stderr.write })).resolves.toBe(0);
    expect(JSON.parse(stdout.lines[0]!)).toEqual(session);
    expect(JSON.parse(stdout.lines[1]!)).toEqual(evidence);
    expect(stderr.lines).toEqual([]);
  });
});
