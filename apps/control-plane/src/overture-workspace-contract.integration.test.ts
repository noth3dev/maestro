import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendOvertureToolActivity, applyAllMigrations, listProjectCatalog, markOvertureRunLaunchedForTaskContract, markOvertureRunLaunchedForTaskContractInTransaction } from "@maestro/persistence";
import { createPostgresOvertureService } from "./overture-service.js";
import { createSessionWorkspace } from "./session-workspace.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const prdMarkdown = `# Homepage — PRD

## Goal
Ship a one-page personal homepage.

## Requirements
- Show a short bio

## Success metrics
- Bio renders

## Repository
/work/homepage

## Base revision
abc1234

## Data boundary
Public content only

## Departments
- engineering
`;

describeDatabase("Overture workspace Task Contract", () => {
  let pool: Pool;
  const root = mkdtempSync(join(tmpdir(), "maestro-workspace-contract-"));
  const workspace = createSessionWorkspace({ root });
  const operatorId = randomUUID();
  const projectId = randomUUID();
  const conversationId = randomUUID();
  const runId = randomUUID();
  const operator = { operatorId };

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await applyAllMigrations(pool);
    await pool.query("INSERT INTO local_operators (operator_id) VALUES ($1) ON CONFLICT (operator_id) DO NOTHING", [operatorId]);
    await pool.query(
      "INSERT INTO conversations (conversation_id, operator_id, project_id, goal_id, model_provider, model_id, status, version, binding) VALUES ($1, $2, $3, NULL, 'openai-codex', 'gpt-5.6-sol', 'active', 1, '{}'::jsonb)",
      [conversationId, operatorId, projectId],
    );
    await pool.query("INSERT INTO operator_project_memberships (membership_id, operator_id, project_id, active) VALUES ($1, $2, $3, true)", [randomUUID(), operatorId, projectId]);
    await pool.query("INSERT INTO operator_project_roles (grant_id, operator_id, project_id, role_id, active) VALUES ($1, $2, $3, 'concertmaster', true)", [randomUUID(), operatorId, projectId]);
  });

  afterAll(async () => {
    await pool.end();
    rmSync(root, { recursive: true, force: true });
  });

  it("drafts the contract from prd.md at the reviewed revision and binds the run to that commit", async () => {
    const service = createPostgresOvertureService({ pool, sessionWorkspace: workspace });
    await service.createRun({ runId, projectId, conversationId, roles: ["conversation-lead"], commandId: randomUUID() }, operator);

    const draft = await workspace.write(projectId, conversationId, [{ path: "plan00.md", content: "# Plan\n" }], "Plan");
    await expect(
      service.createWorkspaceTaskContract!({ runId, projectId, conversationId, revision: draft.revision!, commandId: randomUUID() }, operator),
    ).rejects.toThrow("Write prd.md");

    await workspace.write(projectId, conversationId, [{ path: "prd.md", content: prdMarkdown }], "PRD");
    await appendOvertureToolActivity(pool, { runId, projectId, roleId: "task-editor", kind: "write_file", status: "ok", path: "prd.md" });
    const unreviewed = (await workspace.list(projectId, conversationId)).revision!;
    await expect(
      service.createWorkspaceTaskContract!({ runId, projectId, conversationId, revision: unreviewed, commandId: randomUUID() }, operator),
    ).rejects.toThrow("Ask @review");
    await expect(service.reviewGate!(runId, projectId, conversationId, operator)).resolves.toMatchObject({ state: "missing" });

    const reviewed = await workspace.write(projectId, conversationId, [{ path: "reviews/plan.md", content: "## Blockers\nNone\n" }], "Review");
    await appendOvertureToolActivity(pool, { runId, projectId, roleId: "plan-reviewer", kind: "write_file", status: "ok", path: "reviews/plan.md" });
    await expect(service.reviewGate!(runId, projectId, conversationId, operator)).resolves.toEqual({ state: "passed", reviewer: "plan-reviewer" });
    await expect(
      service.createWorkspaceTaskContract!({ runId, projectId, conversationId, revision: draft.revision!, commandId: randomUUID() }, operator),
    ).rejects.toThrow("workspace changed");

    const commandId = randomUUID();
    const contract = await service.createWorkspaceTaskContract!({ runId, projectId, conversationId, revision: reviewed.revision!, commandId }, operator);
    expect(contract).toMatchObject({
      desiredOutcome: "Ship a one-page personal homepage.",
      launchState: "awaiting_confirmation",
      approvedPreviewReferences: ["plan00.md", "prd.md", "reviews/plan.md"],
    });
    expect(contract.liveEvidence).toContain("review-gate:passed by plan-reviewer");
    expect(contract.evidenceReferences).toEqual([
      expect.stringMatching(new RegExp(`^workspace@${reviewed.revision}:plan00\\.md#[0-9a-f]{64}$`)),
      expect.stringMatching(new RegExp(`^workspace@${reviewed.revision}:prd\\.md#[0-9a-f]{64}$`)),
      expect.stringMatching(new RegExp(`^workspace@${reviewed.revision}:reviews/plan\\.md#[0-9a-f]{64}$`)),
      "review-gate:passed by plan-reviewer",
    ]);

    const run = await service.getRun(runId, projectId, conversationId, operator);
    expect(run).toMatchObject({ state: "review", taskContractId: contract.contractId, taskContractRef: { workspaceRevision: reviewed.revision, taskPath: "prd.md" } });

    const replay = await service.createWorkspaceTaskContract!({ runId, projectId, conversationId, revision: reviewed.revision!, commandId }, operator);
    expect(replay.contractId).toBe(contract.contractId);

    await workspace.write(projectId, conversationId, [{ path: "plan00.md", content: "# Plan v2\n" }], "Later edit");
    await markOvertureRunLaunchedForTaskContract(pool, contract.contractId);
    await expect(service.getRun(runId, projectId, conversationId, operator)).resolves.toMatchObject({ state: "launched" });
  });

  it("records crew tool activity as Overture events", async () => {
    const service = createPostgresOvertureService({ pool, sessionWorkspace: workspace });
    await appendOvertureToolActivity(pool, { runId, projectId, roleId: "design-mock-specialist", kind: "write_file", status: "ok", path: "design/signup.html", detail: "2048 bytes" });
    const events = await service.listEvents(runId, projectId, conversationId, "0", operator);
    expect(events.filter((event) => event.eventType === "tool_activity").map((event) => event.payload)).toContainEqual({
      roleId: "design-mock-specialist",
      kind: "write_file",
      status: "ok",
      path: "design/signup.html",
      detail: "2048 bytes",
    });
  });

  it("lets the operator accept an unmet review gate and records it as evidence", async () => {
    const service = createPostgresOvertureService({ pool, sessionWorkspace: workspace });
    const otherConversationId = randomUUID();
    const otherRunId = randomUUID();
    await pool.query(
      "INSERT INTO conversations (conversation_id, operator_id, project_id, goal_id, model_provider, model_id, status, version, binding) VALUES ($1, $2, $3, NULL, 'openai-codex', 'gpt-5.6-sol', 'active', 1, '{}'::jsonb)",
      [otherConversationId, operatorId, projectId],
    );
    await service.createRun({ runId: otherRunId, projectId, conversationId: otherConversationId, roles: ["conversation-lead"], commandId: randomUUID() }, operator);
    const written = await workspace.write(projectId, otherConversationId, [{ path: "prd.md", content: prdMarkdown }], "PRD");
    const contract = await service.createWorkspaceTaskContract!(
      { runId: otherRunId, projectId, conversationId: otherConversationId, revision: written.revision!, acceptReviewBlockers: true, commandId: randomUUID() },
      operator,
    );
    expect(contract.liveEvidence.at(-1)).toMatch(/^review-gate:missing accepted by operator \(Ask @review/);
  });

  it("starts the Goal in a new project created at PRD approval", async () => {
    const service = createPostgresOvertureService({ pool, sessionWorkspace: workspace });
    const sessionId = randomUUID();
    const sessionRunId = randomUUID();
    await pool.query(
      "INSERT INTO conversations (conversation_id, operator_id, project_id, goal_id, model_provider, model_id, status, version, binding) VALUES ($1, $2, $3, NULL, 'openai-codex', 'gpt-5.6-sol', 'active', 1, '{}'::jsonb)",
      [sessionId, operatorId, projectId],
    );
    await service.createRun({ runId: sessionRunId, projectId, conversationId: sessionId, roles: ["conversation-lead"], commandId: randomUUID() }, operator);
    const broken = await workspace.write(projectId, sessionId, [{ path: "prd.md", content: "# PRD\n## Goal\nx\n" }], "Incomplete PRD");
    const before = (await listProjectCatalog(pool, operatorId)).length;
    await expect(
      service.createWorkspaceTaskContract!({ runId: sessionRunId, projectId, conversationId: sessionId, revision: broken.revision!, acceptReviewBlockers: true, target: { kind: "new", name: "Homepage" }, commandId: randomUUID() }, operator),
    ).rejects.toThrow(/missing/);
    expect(await listProjectCatalog(pool, operatorId)).toHaveLength(before);

    const written = await workspace.write(projectId, sessionId, [{ path: "prd.md", content: prdMarkdown }], "PRD");
    const commandId = randomUUID();
    const input = { runId: sessionRunId, projectId, conversationId: sessionId, revision: written.revision!, acceptReviewBlockers: true, target: { kind: "new" as const, name: "Homepage" }, commandId };
    const contract = await service.createWorkspaceTaskContract!(input, operator);
    const created = (await listProjectCatalog(pool, operatorId)).find((project) => project.name === "Homepage")!;
    expect(created).toMatchObject({ kind: "project" });
    expect(contract.project.projectId).toBe(created.projectId);
    expect((await service.createWorkspaceTaskContract!(input, operator)).contractId).toBe(contract.contractId);
    expect((await listProjectCatalog(pool, operatorId)).filter((project) => project.name === "Homepage")).toHaveLength(1);
    // The session stays where it was; the run points at the Goal's project.
    await expect(service.getRun(sessionRunId, projectId, sessionId, operator)).resolves.toMatchObject({ targetProjectId: created.projectId, taskContractId: contract.contractId });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await expect(markOvertureRunLaunchedForTaskContractInTransaction(client, contract.contractId, randomUUID(), projectId)).rejects.toThrow(/does not match/);
      await client.query("ROLLBACK");
      await client.query("BEGIN");
      await markOvertureRunLaunchedForTaskContractInTransaction(client, contract.contractId, randomUUID(), created.projectId);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    await expect(service.getRun(sessionRunId, projectId, sessionId, operator)).resolves.toMatchObject({ state: "launched" });
  });
});
