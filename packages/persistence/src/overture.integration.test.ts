import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildOverturePlanManifest, overturePlanContentHash } from "@maestro/domain";
import {
  appendOvertureMessage,
  answerOvertureClarification,
  attachOvertureTaskContract,
  bindOvertureRoleModel,
  createOvertureArtifact,
  createOvertureRun,
  createOvertureOperatorTurn,
  openOvertureClarification,
  readOvertureArtifacts,
  markOvertureRunLaunchedForTaskContract,
  readOvertureEvents,
  readOvertureMessages,
  readOverturePlanManifest,
  readOvertureRun,
  reviseOverturePlan,
} from "./overture.js";
import { createDurableTaskContract, launchConfirmedTaskContract, recordExactTaskContractConfirmation } from "./task-contract.js";
import { applyAllMigrations } from "./test-migrations.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const projectId = "11111111-1111-4111-8111-111111111111";
const conversationId = "33333333-3333-4333-8333-333333333333";
const runId = "22222222-2222-4222-8222-222222222222";
const turnId = "66666666-6666-4666-8666-666666666666";

function plan(content: string) {
  return { content, contentHash: overturePlanContentHash(content) };
}

describe("Overture persistence source", () => {
  it("ships migration 0107 with all durable pre-Goal tables", () => {
    const sql = readFileSync(fileURLToPath(new URL("../migrations/0107_overture_runs_and_plan_sets.sql", import.meta.url)), "utf8");
    for (const table of [
      "overture_runs",
      "overture_role_assignments",
      "overture_messages",
      "overture_clarifications",
      "overture_artifacts",
      "overture_plan_documents",
      "overture_plan_revisions",
      "overture_manifest_revisions",
      "overture_events",
      "overture_outbox",
    ])
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
  });
});

describeDatabase("Overture PostgreSQL persistence", () => {
  let pool: Pool;
  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await applyAllMigrations(pool);
    await pool.query(
      "INSERT INTO conversations (conversation_id, operator_id, project_id, goal_id, model_provider, model_id, status, version, binding) VALUES ($1, $2, $3, NULL, 'test', 'test-model', 'active', 1, '{}'::jsonb)",
      [conversationId, `operator-${randomUUID()}`, projectId],
    );
    await pool.query(
      "INSERT INTO conversation_turns (turn_id, conversation_id, project_id, turn_ref, request_id, role, content, status, cursor) VALUES ($1, $2, $3, $1, $1, 'user', 'Build a bounded planning console', 'completed', 1)",
      [turnId, conversationId, projectId],
    );
  });
  afterAll(async () => pool.end());

  it("creates one goal-less run idempotently and preserves role boundaries", async () => {
    const first = await createOvertureRun(pool, {
      runId,
      conversationId,
      projectId,
      commandId: randomUUID(),
      roles: ["conversation-lead", "security-evaluator", "task-editor"],
    });
    const replay = await createOvertureRun(pool, {
      runId,
      conversationId,
      projectId,
      commandId: randomUUID(),
      roles: ["conversation-lead", "security-evaluator", "task-editor"],
    });
    expect(first).toMatchObject({
      runId,
      conversationId,
      projectId,
      goalId: null,
      executionPhase: "overture",
      taskContractRef: null,
      state: "collecting",
      version: 1,
    });
    expect(
      (await pool.query("SELECT count(*)::int AS count FROM overture_events WHERE run_id = $1 AND event_type = 'role_activated'", [runId]))
        .rows[0].count,
    ).toBe(3);
    const events = await readOvertureEvents(pool, runId, projectId, conversationId);
    expect(events.map((event) => event.eventType)).toEqual(["run_created", "role_activated", "role_activated", "role_activated"]);
    expect((await pool.query("SELECT count(*)::int AS count FROM overture_outbox WHERE run_id = $1", [runId])).rows[0].count).toBe(
      events.length,
    );
    expect(replay).toEqual(first);
    await bindOvertureRoleModel(pool, { runId, projectId, roleId: "conversation-lead", modelRef: "anthropic/claude-3-5-sonnet" });
    expect(
      (await readOvertureRun(pool, runId, projectId, conversationId))?.roles.find((role) => role.roleId === "conversation-lead")?.modelRef,
    ).toBe("anthropic/claude-3-5-sonnet");
    expect((await readOvertureRun(pool, runId, projectId, conversationId))?.roles.map((role) => role.roleId)).toEqual([
      "conversation-lead",
      "security-evaluator",
      "task-editor",
    ]);
  });

  it("serializes concurrent command retries and rejects conversation drift", async () => {
    const commandId = randomUUID();
    const args = {
      runId,
      conversationId,
      projectId,
      kind: "research" as const,
      title: "Concurrent",
      content: "same durable result",
      ...plan("same durable result"),
      sourceRefs: [],
      commandId,
    };
    const artifacts = await Promise.all([createOvertureArtifact(pool, args), createOvertureArtifact(pool, args)]);
    expect(artifacts[0]).toEqual(artifacts[1]);

    const messageCommand = randomUUID();
    const messageArgs = {
      runId,
      conversationId,
      projectId,
      turnId,
      actor: "operator" as const,
      modelRef: null,
      content: "same turn result",
      commandId: messageCommand,
    };
    const messages = await Promise.all([appendOvertureMessage(pool, messageArgs), appendOvertureMessage(pool, messageArgs)]);
    expect(messages[0]).toEqual(messages[1]);
    expect(() => messages[0]!.cursor).not.toThrow();
    await expect(
      appendOvertureMessage(pool, { ...messageArgs, conversationId: "99999999-9999-4999-8999-999999999999", commandId: randomUUID() }),
    ).rejects.toThrow(/conversation/);
    await expect(appendOvertureMessage(pool, { ...messageArgs, actor: "architecture-analyst", commandId: randomUUID() })).rejects.toThrow(
      /assigned/,
    );
    await expect(
      pool.query(
        "INSERT INTO overture_artifacts (artifact_id, run_id, project_id, kind, title, content, content_hash, source_refs, command_id) VALUES ($1, $2, $3, 'research', 'safe', $4, $5, '[]'::jsonb, $6)",
        [randomUUID(), runId, projectId, "ghp_123456789012345678901234567890", "0".repeat(64), randomUUID()],
      ),
    ).rejects.toThrow(/prohibited|sensitive/i);
  });

  it("stores same-channel messages, artifacts, clarification answers, and hierarchical plan revisions", async () => {
    const message = await appendOvertureMessage(pool, {
      runId,
      conversationId,
      projectId,
      turnId,
      actor: "operator",
      modelRef: null,
      content: "Build a bounded planning console",
      commandId: randomUUID(),
    });
    expect(message.content).toContain("bounded");
    const durableMessages = await readOvertureMessages(pool, runId, projectId, conversationId);
    expect(durableMessages.some((item) => item.messageId === message.messageId && item.actor === "operator")).toBe(true);
    const artifact = await createOvertureArtifact(pool, {
      runId,
      conversationId,
      projectId,
      kind: "security_finding",
      title: "Boundary",
      content: "No execution before launch",
      ...plan("No execution before launch"),
      sourceRefs: [],
      commandId: randomUUID(),
    });
    expect(artifact.contentHash).toBe(overturePlanContentHash(artifact.content));
    const artifacts = await readOvertureArtifacts(pool, runId, projectId, conversationId);
    expect(artifacts.some((item) => item.artifactId === artifact.artifactId && item.kind === "security_finding")).toBe(true);
    const clarification = await openOvertureClarification(pool, {
      runId,
      conversationId,
      projectId,
      question: "Which repository is authoritative?",
      commandId: randomUUID(),
    });
    await answerOvertureClarification(pool, {
      clarificationId: clarification.clarificationId,
      runId,
      conversationId,
      projectId,
      answer: "The connected repository",
      commandId: randomUUID(),
    });
    const answerCommandId = randomUUID();
    const overtureTurn = await createOvertureOperatorTurn(pool, {
      runId,
      conversationId,
      projectId,
      content: "The connected repository",
      commandId: answerCommandId,
    });
    expect(overtureTurn).toMatchObject({ turnId: answerCommandId, created: true, messageCommandId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    await expect(
      createOvertureOperatorTurn(pool, {
        runId,
        conversationId,
        projectId,
        content: "The connected repository",
        commandId: answerCommandId,
      }),
    ).resolves.toMatchObject({ turnId: answerCommandId, created: false, messageCommandId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect((await pool.query("SELECT role, status, content FROM conversation_turns WHERE turn_id = $1", [answerCommandId])).rows[0]).toMatchObject({
      role: "user",
      status: "accepted",
      content: "The connected repository",
    });
    const plan00 = await reviseOverturePlan(pool, {
      runId,
      conversationId,
      projectId,
      documentId: randomUUID(),
      path: "plan00.md",
      kind: "project",
      expectedVersion: 0,
      ...plan("# Whole project blueprint"),
      sourceRefs: [],
      dependencies: [],
      commandId: randomUUID(),
    });
    const phase = await reviseOverturePlan(pool, {
      runId,
      conversationId,
      projectId,
      documentId: randomUUID(),
      path: "plan01.md",
      kind: "phase",
      expectedVersion: 0,
      ...plan("# Phase 01"),
      sourceRefs: [],
      dependencies: [plan00.documentId],
      commandId: randomUUID(),
    });
    const slice = await reviseOverturePlan(pool, {
      runId,
      conversationId,
      projectId,
      documentId: randomUUID(),
      path: "plan01-slice01.md",
      kind: "slice",
      expectedVersion: 0,
      ...plan("# Slice 01"),
      sourceRefs: [artifact.artifactId],
      dependencies: [phase.documentId],
      commandId: randomUUID(),
    });
    const manifest = await readOverturePlanManifest(pool, runId, projectId, conversationId);
    expect(manifest).toEqual(buildOverturePlanManifest({ projectId, runId, documents: [plan00, phase, slice] }));
    expect(
      (await pool.query("SELECT count(*)::int AS count FROM overture_manifest_revisions WHERE run_id = $1", [runId])).rows[0].count,
    ).toBe(3);
    expect(
      (await pool.query("SELECT plan_manifest_hash FROM overture_runs WHERE run_id = $1", [runId])).rows[0].plan_manifest_hash.trim(),
    ).toBe(manifest.manifestHash);
    expect(message.messageId).not.toBe(artifact.artifactId);
  });

  it("binds one awaiting Task Contract to the exact current plan manifest", async () => {
    const manifest = await readOverturePlanManifest(pool, runId, projectId, conversationId);
    const contractId = randomUUID();
    const contract = await createDurableTaskContract(pool, contractId, {
      desiredOutcome: "Ship the bounded planning console",
      userVisibleBehavior: ["The console is visible"],
      successCriteria: ["The console is verified"],
      liveEvidence: ["Durable Overture run"],
      scope: ["This project"],
      nonGoals: ["Unrelated work"],
      priorities: ["Safety"],
      acceptableTradeoffs: ["Bounded scope"],
      constraints: ["Confirmation required"],
      knownEdgeCases: ["Retry"],
      project: { projectId, repository: "repo", immutableBaseRevision: "base", dataBoundary: "project" },
      evidenceReferences: [],
      approvedPreviewReferences: [],
      expectedGroups: ["group"],
      expectedDepartments: ["department"],
      criticalActionExpectations: ["Show effect"],
      forbiddenEffects: ["Unapproved effect"],
      environmentAssumptions: ["Local"],
      externalServiceAssumptions: ["None"],
      budget: { ceiling: "bounded", reportingExpectations: ["Report"], stoppingConditions: ["Stop"] },
    });
    await attachOvertureTaskContract(pool, {
      runId,
      projectId,
      conversationId,
      contractId: contract.contractId,
      planId: manifest.documents[0]!.documentId,
      planVersion: manifest.documents[0]!.version,
      manifestHash: manifest.manifestHash,
      commandId: randomUUID(),
    });
    await expect(
      reviseOverturePlan(pool, {
        runId,
        conversationId,
        projectId,
        documentId: manifest.documents[0]!.documentId,
        path: "plan00.md",
        kind: "project",
        expectedVersion: manifest.documents[0]!.version,
        ...plan("# Changed after attachment"),
        sourceRefs: [],
        dependencies: [],
        commandId: randomUUID(),
      }),
    ).rejects.toThrow("after Task Contract attachment");
    const run = await readOvertureRun(pool, runId, projectId, conversationId);
    expect(run?.taskContractId).toBe(contract.contractId);
    expect(run?.taskContractRef).toEqual({
      planId: manifest.documents[0]!.documentId,
      version: manifest.documents[0]!.version,
      manifestHash: manifest.manifestHash,
    });
    expect(run?.state).toBe("review");
    await recordExactTaskContractConfirmation(
      pool,
      contract.contractId,
      contract.version,
      contract.contentHash,
      "operator-1",
      randomUUID(),
    );
    await launchConfirmedTaskContract(pool, contract.contractId);
    await markOvertureRunLaunchedForTaskContract(pool, contract.contractId);
    expect((await readOvertureRun(pool, runId, projectId, conversationId))?.state).toBe("launched");
  });

  it("rejects cross-project reads and direct revision mutation", async () => {
    await expect(readOvertureRun(pool, runId, "99999999-9999-4999-8999-999999999999", conversationId)).resolves.toBeUndefined();
    const document = await pool.query("SELECT document_id FROM overture_plan_documents WHERE run_id = $1 AND path = 'plan00.md'", [runId]);
    await expect(
      pool.query("UPDATE overture_plan_revisions SET content = 'tampered' WHERE document_id = $1", [document.rows[0].document_id]),
    ).rejects.toThrow(/append-only/i);
  });
});
