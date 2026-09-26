import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendOvertureToolActivity, applyAllMigrations, markOvertureRunLaunchedForTaskContract } from "@maestro/persistence";
import { createPostgresOvertureService } from "./overture-service.js";
import { createSessionWorkspace } from "./session-workspace.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const taskMarkdown = `# Homepage

## Outcome
Ship a one-page personal homepage.

## Success criteria
- Bio renders

## Repository
/work/homepage

## Base revision
abc1234

## Data boundary
Public content only

## Groups
- product

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

  it("drafts the contract from task.md at the reviewed revision and binds the run to that commit", async () => {
    const service = createPostgresOvertureService({ pool, sessionWorkspace: workspace });
    await service.createRun({ runId, projectId, conversationId, roles: ["conversation-lead"], commandId: randomUUID() }, operator);

    const draft = await workspace.write(projectId, conversationId, [{ path: "plan00.md", content: "# Plan\n" }], "Plan");
    await expect(
      service.createWorkspaceTaskContract!({ runId, projectId, conversationId, revision: draft.revision!, commandId: randomUUID() }, operator),
    ).rejects.toThrow("Write task.md");

    await workspace.write(projectId, conversationId, [{ path: "task.md", content: taskMarkdown }], "Task");
    await appendOvertureToolActivity(pool, { runId, projectId, roleId: "task-editor", kind: "write_file", status: "ok", path: "task.md" });
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
      approvedPreviewReferences: ["plan00.md", "reviews/plan.md", "task.md"],
    });
    expect(contract.liveEvidence).toContain("review-gate:passed by plan-reviewer");
    expect(contract.evidenceReferences).toEqual([
      expect.stringMatching(new RegExp(`^workspace@${reviewed.revision}:plan00\\.md#[0-9a-f]{64}$`)),
      expect.stringMatching(new RegExp(`^workspace@${reviewed.revision}:reviews/plan\\.md#[0-9a-f]{64}$`)),
      expect.stringMatching(new RegExp(`^workspace@${reviewed.revision}:task\\.md#[0-9a-f]{64}$`)),
      "review-gate:passed by plan-reviewer",
    ]);

    const run = await service.getRun(runId, projectId, conversationId, operator);
    expect(run).toMatchObject({ state: "review", taskContractId: contract.contractId, taskContractRef: { workspaceRevision: reviewed.revision, taskPath: "task.md" } });

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
    const written = await workspace.write(projectId, otherConversationId, [{ path: "task.md", content: taskMarkdown }], "Task");
    const contract = await service.createWorkspaceTaskContract!(
      { runId: otherRunId, projectId, conversationId: otherConversationId, revision: written.revision!, acceptReviewBlockers: true, commandId: randomUUID() },
      operator,
    );
    expect(contract.liveEvidence.at(-1)).toMatch(/^review-gate:missing accepted by operator \(Ask @review/);
  });
});
