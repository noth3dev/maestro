import { describe, expect, it, vi } from "vitest";
import { executeCli } from "./main.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const commandId = "33333333-3333-4333-8333-333333333333";
const env = { MAESTRO_API_URL: "https://maestro.test", MAESTRO_API_TOKEN: "top-secret" };

function output() {
  const lines: string[] = [];
  return { lines, write: (line: string) => { lines.push(line); } };
}

describe("executeCli", () => {
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
