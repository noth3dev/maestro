import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  OVERTURE_ROLE_IDS,
  assertValidOverturePlanPath,
  buildOverturePlanManifest,
  canonicalJson,
  isSafeOvertureText,
  overturePlanContentHash,
  type OverturePlanDocument,
  type OverturePlanDocumentKind,
  type OverturePlanManifest,
  type OvertureRoleId,
} from "@maestro/domain";
import {
  OvertureArtifactSchema,
  OvertureEventSchema,
  OvertureClarificationSchema,
  OvertureMessageSchema,
  OverturePlanDocumentSchema,
  OvertureRunSchema,
  type OvertureArtifact,
  type OvertureClarification,
  type OvertureMessage,
  type OvertureRun,
} from "@maestro/contracts";

export class OvertureRunNotFoundError extends Error {}
export class OvertureConflictError extends Error {}
export class OvertureVersionConflictError extends Error {}
export class OvertureIntegrityError extends Error {}

type Queryable = Pick<Pool | PoolClient, "query">;
type RoleRow = { role_id: OvertureRoleId; status: "queued" | "active" | "paused" | "completed" | "failed"; model_ref: string | null };
type RunRow = {
  run_id: string;
  conversation_id: string;
  project_id: string;
  goal_id: null;
  execution_phase: "overture";
  task_contract_ref: Record<string, unknown> | null;
  task_contract_id: string | null;
  state: OvertureRun["state"];
  version: string;
  role_taxonomy_version: number;
  plan_manifest_hash: string | null;
};
type MessageRow = {
  message_id: string;
  run_id: string;
  conversation_id: string;
  project_id: string;
  message_sequence: string;
  message_cursor: string;
  turn_id: string;
  actor_kind: "operator" | "concertmaster" | "role";
  actor_id: string;
  model_ref: string | null;
  content: string;
  created_at: Date | string;
};
type ArtifactRow = {
  artifact_id: string;
  run_id: string;
  project_id: string;
  kind: OvertureArtifact["kind"];
  title: string;
  content: string;
  content_hash: string;
  source_refs: readonly string[];
  created_at: Date | string;
};
type EventRow = {
  event_id: string;
  run_id: string;
  project_id: string;
  cursor: string;
  event_type: string;
  payload: Record<string, unknown>;
  occurred_at: Date | string;
};
type ClarificationRow = {
  clarification_id: string;
  run_id: string;
  project_id: string;
  question: string;
  answer: string | null;
  answer_command_id: string | null;
  status: OvertureClarification["status"];
  command_id: string;
  created_at: Date | string;
};
type PlanRow = {
  document_id: string;
  run_id: string;
  project_id: string;
  path: string;
  kind: OverturePlanDocumentKind;
  version: string;
  content: string;
  content_hash: string;
  source_refs: readonly string[];
  dependencies: readonly string[];
};

const roleSet = new Set<string>(OVERTURE_ROLE_IDS);

export async function createOvertureRun(
  pool: Pool,
  args: {
    readonly runId: string;
    readonly conversationId: string;
    readonly projectId: string;
    readonly commandId: string;
    readonly roles: readonly OvertureRoleId[];
  },
): Promise<OvertureRun> {
  const requestedRoles = [...new Set(args.roles)];
  if (requestedRoles.length === 0 || requestedRoles.some((role) => !roleSet.has(role)))
    throw new OvertureConflictError("Overture roles are invalid");
  const roles = OVERTURE_ROLE_IDS.filter((role) => requestedRoles.includes(role));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<RunRow>(
      "SELECT run_id, conversation_id, project_id, goal_id, execution_phase, task_contract_ref, task_contract_id, state, version, role_taxonomy_version, plan_manifest_hash FROM overture_runs WHERE run_id = $1 FOR UPDATE",
      [args.runId],
    );
    if (existing.rowCount === 1) {
      const current = await readRunWithinTransaction(client, args.runId, args.projectId, args.conversationId);
      if (current === undefined) throw new OvertureRunNotFoundError(`Overture run not found: ${args.runId}`);
      const currentRoleIds = current.roles.map((role) => role.roleId);
      if (
        current.projectId !== args.projectId ||
        current.conversationId !== args.conversationId ||
        canonicalJson(currentRoleIds) !== canonicalJson(roles)
      )
        throw new OvertureConflictError("Overture run identity was reused with different content");
      await client.query("COMMIT");
      return current;
    }
    const inserted = await client.query(
      "INSERT INTO overture_runs (run_id, conversation_id, project_id, state, version, role_taxonomy_version, create_command_id) VALUES ($1, $2, $3, 'collecting', 1, 2, $4) ON CONFLICT DO NOTHING",
      [args.runId, args.conversationId, args.projectId, args.commandId],
    );
    if (inserted.rowCount !== 1) throw new OvertureConflictError("Overture run command or conversation is already in use");
    for (const roleId of OVERTURE_ROLE_IDS.filter((role) => roles.includes(role))) {
      await client.query(
        "INSERT INTO overture_role_assignments (run_id, project_id, role_id, status, model_ref) VALUES ($1, $2, $3, $4, NULL)",
        [args.runId, args.projectId, roleId, roleId === "conversation-lead" || roleId === "task-editor" ? "active" : "queued"],
      );
    }
    await appendEvent(client, {
      runId: args.runId,
      projectId: args.projectId,
      commandId: args.commandId,
      eventType: "run_created",
      payload: { conversationId: args.conversationId, roles },
    });
    for (const roleId of roles)
      await appendEvent(client, {
        runId: args.runId,
        projectId: args.projectId,
        commandId: randomUUID(),
        eventType: "role_activated",
        payload: { roleId },
      });
    const result = await readRunWithinTransaction(client, args.runId, args.projectId, args.conversationId);
    if (result === undefined) throw new OvertureIntegrityError(`Created Overture run could not be read: ${args.runId}`);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function readOvertureRun(
  queryable: Queryable,
  runId: string,
  projectId: string,
  conversationId: string,
): Promise<OvertureRun | undefined> {
  return readRunWithinTransaction(queryable, runId, projectId, conversationId);
}

export async function appendOvertureMessage(
  pool: Pool,
  args: {
    readonly runId: string;
    readonly conversationId: string;
    readonly projectId: string;
    readonly turnId: string;
    readonly actor: "operator" | "concertmaster" | OvertureRoleId;
    readonly modelRef: string | null;
    readonly content: string;
    readonly commandId: string;
  },
): Promise<OvertureMessage> {
  assertSafeContent(args.content);
  if (args.modelRef !== null) assertSafeContent(args.modelRef);
  const actorKind = args.actor === "operator" || args.actor === "concertmaster" ? args.actor : "role";
  const actorId = actorKind === "role" ? args.actor : actorKind;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const run = await client.query<RunRow>(
      "SELECT run_id, conversation_id, project_id, goal_id, execution_phase, task_contract_ref, task_contract_id, state, version, role_taxonomy_version, plan_manifest_hash FROM overture_runs WHERE run_id = $1 AND project_id = $2 FOR UPDATE",
      [args.runId, args.projectId],
    );
    if (run.rowCount !== 1 || run.rows[0]!.conversation_id !== args.conversationId)
      throw new OvertureConflictError("Overture message conversation does not match its Run");
    const turn = await client.query("SELECT 1 FROM conversation_turns WHERE turn_id = $1 AND conversation_id = $2 AND project_id = $3", [
      args.turnId,
      args.conversationId,
      args.projectId,
    ]);
    if (turn.rowCount !== 1) throw new OvertureConflictError("Overture message turn does not match its conversation");
    if (actorKind === "role") {
      const assignment = await client.query(
        "SELECT 1 FROM overture_role_assignments WHERE run_id = $1 AND project_id = $2 AND role_id = $3",
        [args.runId, args.projectId, actorId],
      );
      if (assignment.rowCount !== 1) throw new OvertureConflictError("Overture message role is not assigned to its Run");
    }
    const prior = await client.query<MessageRow>(
      "SELECT message_id, run_id, conversation_id, project_id, message_sequence, message_cursor, turn_id, actor_kind, actor_id, model_ref, content, created_at FROM overture_messages WHERE run_id = $1 AND command_id = $2",
      [args.runId, args.commandId],
    );
    if (prior.rowCount === 1) {
      const row = prior.rows[0]!;
      if (
        row.project_id !== args.projectId ||
        row.conversation_id !== args.conversationId ||
        row.turn_id !== args.turnId ||
        row.content !== args.content ||
        row.actor_id !== actorId ||
        row.model_ref !== args.modelRef
      )
        throw new OvertureConflictError("Overture message command was reused with different content");
      await client.query("COMMIT");
      return toMessage(row);
    }
    const cursor = await client.query<{ cursor: string }>(
      "SELECT (COALESCE(MAX(message_cursor), 0) + 1)::text AS cursor FROM overture_messages WHERE run_id = $1 AND project_id = $2",
      [args.runId, args.projectId],
    );
    const inserted = await client.query<MessageRow>(
      "INSERT INTO overture_messages (message_id, message_cursor, turn_id, run_id, project_id, conversation_id, actor_kind, actor_id, model_ref, content, command_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING message_id, run_id, conversation_id, project_id, message_sequence, message_cursor, turn_id, actor_kind, actor_id, model_ref, content, created_at",
      [
        randomUUID(),
        cursor.rows[0]!.cursor,
        args.turnId,
        args.runId,
        args.projectId,
        args.conversationId,
        actorKind,
        actorId,
        args.modelRef,
        args.content,
        args.commandId,
      ],
    );
    const row = inserted.rows[0]!;
    await appendEvent(client, {
      runId: args.runId,
      projectId: args.projectId,
      commandId: args.commandId,
      eventType: "message_appended",
      payload: { messageId: row.message_id, actor: args.actor },
    });
    await client.query("COMMIT");
    return toMessage(row);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createOvertureArtifact(
  pool: Pool,
  args: {
    readonly runId: string;
    readonly conversationId: string;
    readonly projectId: string;
    readonly kind: OvertureArtifact["kind"];
    readonly title: string;
    readonly content: string;
    readonly contentHash: string;
    readonly sourceRefs: readonly string[];
    readonly commandId: string;
  },
): Promise<OvertureArtifact> {
  assertContentHash(args.content, args.contentHash);
  assertSafeContent(args.title);
  for (const sourceRef of args.sourceRefs) assertSafeContent(sourceRef);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const run = await client.query<{ conversation_id: string }>(
      "SELECT conversation_id FROM overture_runs WHERE run_id = $1 AND project_id = $2 FOR UPDATE",
      [args.runId, args.projectId],
    );
    if (run.rowCount !== 1) throw new OvertureRunNotFoundError("Overture run not found");
    if (run.rows[0]!.conversation_id !== args.conversationId)
      throw new OvertureConflictError("Overture artifact conversation does not match its Run");
    const prior = await client.query<ArtifactRow>(
      "SELECT artifact_id, run_id, project_id, kind, title, content, content_hash, source_refs, created_at FROM overture_artifacts WHERE run_id = $1 AND command_id = $2",
      [args.runId, args.commandId],
    );
    if (prior.rowCount === 1) {
      const row = prior.rows[0]!;
      if (
        row.project_id !== args.projectId ||
        row.kind !== args.kind ||
        row.title !== args.title ||
        row.content !== args.content ||
        row.content_hash.trim() !== args.contentHash ||
        canonicalJson(row.source_refs) !== canonicalJson(args.sourceRefs)
      )
        throw new OvertureConflictError("Overture artifact command was reused with different content");
      await client.query("COMMIT");
      return toArtifact(row);
    }
    const inserted = await client.query<ArtifactRow>(
      "INSERT INTO overture_artifacts (artifact_id, run_id, project_id, kind, title, content, content_hash, source_refs, command_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9) RETURNING artifact_id, run_id, project_id, kind, title, content, content_hash, source_refs, created_at",
      [
        randomUUID(),
        args.runId,
        args.projectId,
        args.kind,
        args.title,
        args.content,
        args.contentHash,
        JSON.stringify(args.sourceRefs),
        args.commandId,
      ],
    );
    const row = inserted.rows[0]!;
    await appendEvent(client, {
      runId: args.runId,
      projectId: args.projectId,
      commandId: args.commandId,
      eventType: "artifact_created",
      payload: { artifactId: row.artifact_id, kind: row.kind },
    });
    await client.query("COMMIT");
    return toArtifact(row);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function openOvertureClarification(
  pool: Pool,
  args: {
    readonly runId: string;
    readonly conversationId: string;
    readonly projectId: string;
    readonly question: string;
    readonly commandId: string;
  },
): Promise<OvertureClarification> {
  assertSafeContent(args.question);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const run = await client.query<{ conversation_id: string }>(
      "SELECT conversation_id FROM overture_runs WHERE run_id = $1 AND project_id = $2 FOR UPDATE",
      [args.runId, args.projectId],
    );
    if (run.rowCount !== 1) throw new OvertureRunNotFoundError("Overture run not found");
    if (run.rows[0]!.conversation_id !== args.conversationId)
      throw new OvertureConflictError("Overture clarification conversation does not match its Run");
    const prior = await client.query<ClarificationRow>(
      "SELECT clarification_id, run_id, project_id, question, answer, answer_command_id, status, command_id, created_at FROM overture_clarifications WHERE run_id = $1 AND command_id = $2",
      [args.runId, args.commandId],
    );
    if (prior.rowCount === 1) {
      const row = prior.rows[0]!;
      if (row.project_id !== args.projectId || row.question !== args.question)
        throw new OvertureConflictError("Overture clarification command was reused with different content");
      await client.query("COMMIT");
      return toClarification(row);
    }
    const inserted = await client.query<ClarificationRow>(
      "INSERT INTO overture_clarifications (clarification_id, run_id, project_id, question, status, command_id) VALUES ($1, $2, $3, $4, 'open', $5) RETURNING clarification_id, run_id, project_id, question, answer, answer_command_id, status, command_id, created_at",
      [randomUUID(), args.runId, args.projectId, args.question, args.commandId],
    );
    const row = inserted.rows[0]!;
    await appendEvent(client, {
      runId: args.runId,
      projectId: args.projectId,
      commandId: args.commandId,
      eventType: "clarification_opened",
      payload: { clarificationId: row.clarification_id },
    });
    await client.query("COMMIT");
    return toClarification(row);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function answerOvertureClarification(
  pool: Pool,
  args: {
    readonly clarificationId: string;
    readonly runId: string;
    readonly conversationId: string;
    readonly projectId: string;
    readonly answer: string;
    readonly commandId: string;
  },
): Promise<OvertureClarification> {
  assertSafeContent(args.answer);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const run = await client.query<{ conversation_id: string }>(
      "SELECT conversation_id FROM overture_runs WHERE run_id = $1 AND project_id = $2 FOR UPDATE",
      [args.runId, args.projectId],
    );
    if (run.rowCount !== 1) throw new OvertureRunNotFoundError("Overture run not found");
    if (run.rows[0]!.conversation_id !== args.conversationId)
      throw new OvertureConflictError("Overture clarification conversation does not match its Run");
    const current = await client.query<ClarificationRow>(
      "SELECT clarification_id, run_id, project_id, question, answer, answer_command_id, status, command_id, created_at FROM overture_clarifications WHERE clarification_id = $1 AND run_id = $2 AND project_id = $3 FOR UPDATE",
      [args.clarificationId, args.runId, args.projectId],
    );
    if (current.rowCount !== 1) throw new OvertureRunNotFoundError("Overture clarification not found");
    const row = current.rows[0]!;
    if (row.status === "answered") {
      if (row.answer !== args.answer || row.answer_command_id !== args.commandId)
        throw new OvertureConflictError("Overture clarification answer command was reused with different content");
      await client.query("COMMIT");
      return toClarification(row);
    }
    if (row.status === "cancelled") throw new OvertureConflictError("Cancelled Overture clarifications cannot be answered");
    const updated = await client.query<ClarificationRow>(
      "UPDATE overture_clarifications SET answer = $2, status = 'answered', answer_command_id = $3, answered_at = transaction_timestamp() WHERE clarification_id = $1 RETURNING clarification_id, run_id, project_id, question, answer, answer_command_id, status, command_id, created_at",
      [args.clarificationId, args.answer, args.commandId],
    );
    const next = updated.rows[0]!;
    await appendEvent(client, {
      runId: args.runId,
      projectId: args.projectId,
      commandId: args.commandId,
      eventType: "clarification_answered",
      payload: { clarificationId: args.clarificationId },
    });
    await client.query("COMMIT");
    return toClarification(next);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function reviseOverturePlan(
  pool: Pool,
  args: {
    readonly runId: string;
    readonly conversationId: string;
    readonly projectId: string;
    readonly documentId: string;
    readonly path: string;
    readonly kind: OverturePlanDocumentKind;
    readonly expectedVersion: number;
    readonly content: string;
    readonly contentHash: string;
    readonly sourceRefs: readonly string[];
    readonly dependencies: readonly string[];
    readonly commandId: string;
  },
): Promise<OverturePlanDocument> {
  assertValidOverturePlanPath(args.path, args.kind);
  assertContentHash(args.content, args.contentHash);
  for (const sourceRef of args.sourceRefs) assertSafeContent(sourceRef);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const run = await client.query<{ conversation_id: string }>(
      "SELECT conversation_id FROM overture_runs WHERE run_id = $1 AND project_id = $2 FOR UPDATE",
      [args.runId, args.projectId],
    );
    if (run.rowCount !== 1) throw new OvertureRunNotFoundError("Overture run not found");
    if (run.rows[0]!.conversation_id !== args.conversationId)
      throw new OvertureConflictError("Overture plan conversation does not match its Run");
    const prior = await client.query<PlanRow>(
      "SELECT d.document_id, d.run_id, d.project_id, d.path, d.kind, r.version, r.content, r.content_hash, r.source_refs, r.dependencies FROM overture_plan_documents d JOIN overture_plan_revisions r ON r.document_id = d.document_id AND r.run_id = d.run_id AND r.project_id = d.project_id WHERE d.run_id = $1 AND d.project_id = $2 AND r.command_id = $3",
      [args.runId, args.projectId, args.commandId],
    );
    if (prior.rowCount === 1) {
      const row = prior.rows[0]!;
      if (
        row.document_id !== args.documentId ||
        row.path !== args.path ||
        row.kind !== args.kind ||
        row.content !== args.content ||
        row.content_hash.trim() !== args.contentHash ||
        canonicalJson(row.source_refs) !== canonicalJson(args.sourceRefs) ||
        canonicalJson(row.dependencies) !== canonicalJson(args.dependencies)
      )
        throw new OvertureConflictError("Overture plan command was reused with different content");
      await client.query("COMMIT");
      return toPlanDocument(row);
    }
    const document = await client.query<{
      document_id: string;
      run_id: string;
      project_id: string;
      path: string;
      kind: OverturePlanDocumentKind;
    }>(
      "SELECT document_id, run_id, project_id, path, kind FROM overture_plan_documents WHERE run_id = $1 AND project_id = $2 AND path = $3 FOR UPDATE",
      [args.runId, args.projectId, args.path],
    );
    if (document.rowCount === 0) {
      if (args.expectedVersion !== 0) throw new OvertureVersionConflictError("New Overture plan document must start at version 0");
      await client.query("INSERT INTO overture_plan_documents (document_id, run_id, project_id, path, kind) VALUES ($1, $2, $3, $4, $5)", [
        args.documentId,
        args.runId,
        args.projectId,
        args.path,
        args.kind,
      ]);
    } else {
      const current = document.rows[0]!;
      if (current.document_id !== args.documentId || current.kind !== args.kind)
        throw new OvertureConflictError("Overture plan document identity was reused with different content");
    }
    const latest = await client.query<{ version: string }>(
      "SELECT version FROM overture_plan_revisions WHERE document_id = $1 ORDER BY version DESC LIMIT 1 FOR UPDATE",
      [args.documentId],
    );
    const currentVersion = latest.rowCount === 0 ? 0 : Number(latest.rows[0]!.version);
    if (currentVersion === 0 && args.path !== "plan00.md") {
      const root = await client.query(
        "SELECT 1 FROM overture_plan_documents d JOIN overture_plan_revisions r ON r.document_id = d.document_id AND r.run_id = d.run_id AND r.project_id = d.project_id WHERE d.run_id = $1 AND d.project_id = $2 AND d.path = 'plan00.md' LIMIT 1",
        [args.runId, args.projectId],
      );
      if (root.rowCount !== 1) throw new OvertureConflictError("plan00.md must be created before phase or slice plans");
    }
    if (currentVersion !== args.expectedVersion)
      throw new OvertureVersionConflictError(`Expected Overture plan version ${args.expectedVersion}, got ${currentVersion}`);
    const revision = await client.query<PlanRow>(
      "INSERT INTO overture_plan_revisions (revision_id, document_id, run_id, project_id, version, content, content_hash, source_refs, dependencies, command_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10) RETURNING document_id, run_id, project_id, version, content, content_hash, source_refs, dependencies",
      [
        randomUUID(),
        args.documentId,
        args.runId,
        args.projectId,
        currentVersion + 1,
        args.content,
        args.contentHash,
        JSON.stringify(args.sourceRefs),
        JSON.stringify(args.dependencies),
        args.commandId,
      ],
    );
    const row = { ...revision.rows[0]!, path: args.path, kind: args.kind };
    await appendEvent(client, {
      runId: args.runId,
      projectId: args.projectId,
      commandId: args.commandId,
      eventType: "plan_revision_created",
      payload: { documentId: args.documentId, path: args.path, version: currentVersion + 1 },
    });
    const manifest = buildOverturePlanManifest({
      projectId: args.projectId,
      runId: args.runId,
      documents: await readPlanDocuments(client, args.runId, args.projectId),
    });
    const manifestVersionResult = await client.query<{ version: string }>(
      "SELECT version FROM overture_manifest_revisions WHERE run_id = $1 ORDER BY version DESC LIMIT 1 FOR UPDATE",
      [args.runId],
    );
    const manifestCommandId = randomUUID();
    await client.query(
      "INSERT INTO overture_manifest_revisions (manifest_revision_id, run_id, project_id, version, documents, manifest_hash, command_id) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)",
      [
        randomUUID(),
        args.runId,
        args.projectId,
        (manifestVersionResult.rowCount === 0 ? 0 : Number(manifestVersionResult.rows[0]!.version)) + 1,
        JSON.stringify(manifest.documents),
        manifest.manifestHash,
        manifestCommandId,
      ],
    );
    await client.query("UPDATE overture_runs SET plan_manifest_hash = $2, updated_at = transaction_timestamp() WHERE run_id = $1", [
      args.runId,
      manifest.manifestHash,
    ]);
    await appendEvent(client, {
      runId: args.runId,
      projectId: args.projectId,
      commandId: manifestCommandId,
      eventType: "manifest_revision_created",
      payload: { manifestHash: manifest.manifestHash },
    });
    await client.query("COMMIT");
    return toPlanDocument(row);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function attachOvertureTaskContract(
  pool: Pool,
  args: {
    readonly runId: string;
    readonly projectId: string;
    readonly conversationId: string;
    readonly contractId: string;
    readonly planId: string;
    readonly planVersion: number;
    readonly manifestHash: string;
    readonly commandId: string;
  },
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const run = await client.query<{
      conversation_id: string;
      task_contract_id: string | null;
      plan_manifest_hash: string | null;
      state: OvertureRun["state"];
      version: string;
    }>(
      "SELECT conversation_id, task_contract_id, plan_manifest_hash, state, version FROM overture_runs WHERE run_id = $1 AND project_id = $2 FOR UPDATE",
      [args.runId, args.projectId],
    );
    if (run.rowCount !== 1) throw new OvertureRunNotFoundError("Overture run not found");
    const current = run.rows[0]!;
    if (current.conversation_id !== args.conversationId)
      throw new OvertureConflictError("Overture Task Contract conversation does not match its Run");
    if (current.task_contract_id !== null) {
      if (current.task_contract_id !== args.contractId)
        throw new OvertureConflictError("Overture Run already has a different Task Contract");
      await client.query("COMMIT");
      return;
    }
    if (current.state === "launched" || current.state === "cancelled")
      throw new OvertureConflictError("Overture Run cannot attach a Task Contract in its current state");
    if (current.plan_manifest_hash?.trim() !== args.manifestHash)
      throw new OvertureConflictError("Task Contract manifest hash does not match the current Overture plan");
    const plan = await client.query<{ version: string }>(
      "SELECT r.version FROM overture_plan_documents d JOIN overture_plan_revisions r ON r.document_id = d.document_id AND r.run_id = d.run_id AND r.project_id = d.project_id WHERE d.document_id = $1 AND d.run_id = $2 AND d.project_id = $3 ORDER BY r.version DESC LIMIT 1",
      [args.planId, args.runId, args.projectId],
    );
    if (plan.rowCount !== 1 || Number(plan.rows[0]!.version) !== args.planVersion)
      throw new OvertureConflictError("Task Contract plan reference is not the current plan revision");
    await client.query(
      "UPDATE overture_runs SET task_contract_id = $2, task_contract_ref = $3::jsonb, state = 'review', version = version + 1, updated_at = transaction_timestamp() WHERE run_id = $1 AND project_id = $4",
      [
        args.runId,
        args.contractId,
        JSON.stringify({ planId: args.planId, version: args.planVersion, manifestHash: args.manifestHash }),
        args.projectId,
      ],
    );
    await appendEvent(client, {
      runId: args.runId,
      projectId: args.projectId,
      commandId: args.commandId,
      eventType: "task_contract_attached",
      payload: { contractId: args.contractId, planId: args.planId, planVersion: args.planVersion, manifestHash: args.manifestHash },
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function markOvertureRunLaunchedForTaskContract(pool: Pool, contractId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const run = await client.query<{ run_id: string; project_id: string; state: OvertureRun["state"] }>(
      "SELECT run_id, project_id, state FROM overture_runs WHERE task_contract_id = $1 FOR UPDATE",
      [contractId],
    );
    if (run.rowCount === 0) {
      await client.query("COMMIT");
      return;
    }
    const current = run.rows[0]!;
    if (current.state === "launched") {
      await client.query("COMMIT");
      return;
    }
    if (current.state !== "review") throw new OvertureConflictError("Only a reviewed Overture Run may be launched");
    await client.query(
      "UPDATE overture_runs SET state = 'launched', version = version + 1, updated_at = transaction_timestamp() WHERE run_id = $1 AND project_id = $2",
      [current.run_id, current.project_id],
    );
    await appendEvent(client, {
      runId: current.run_id,
      projectId: current.project_id,
      commandId: randomUUID(),
      eventType: "run_state_changed",
      payload: { state: "launched", contractId },
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function readOvertureArtifacts(
  queryable: Queryable,
  runId: string,
  projectId: string,
  conversationId: string,
): Promise<ReadonlyArray<OvertureArtifact>> {
  const boundary = await queryable.query("SELECT 1 FROM overture_runs WHERE run_id = $1 AND project_id = $2 AND conversation_id = $3", [
    runId,
    projectId,
    conversationId,
  ]);
  if (boundary.rowCount !== 1) throw new OvertureRunNotFoundError("Overture run not found");
  const result = await queryable.query<ArtifactRow>(
    "SELECT a.artifact_id, a.run_id, a.project_id, a.kind, a.title, a.content, a.content_hash, a.source_refs, a.created_at FROM overture_artifacts a JOIN overture_runs r ON r.run_id = a.run_id AND r.project_id = a.project_id WHERE a.run_id = $1 AND a.project_id = $2 AND r.conversation_id = $3 ORDER BY a.created_at ASC, a.artifact_id ASC",
    [runId, projectId, conversationId],
  );
  return result.rows.map((row) =>
    OvertureArtifactSchema.parse({
      artifactId: row.artifact_id,
      runId: row.run_id,
      projectId: row.project_id,
      kind: row.kind,
      title: row.title,
      content: row.content,
      contentHash: row.content_hash,
      sourceRefs: row.source_refs,
    }),
  );
}

export async function bindOvertureRoleModel(
  pool: Pool,
  args: { readonly runId: string; readonly projectId: string; readonly roleId: OvertureRoleId; readonly modelRef: string },
): Promise<void> {
  if (!isSafeOvertureText(args.modelRef, 256)) throw new OvertureConflictError("Overture role model reference is invalid");
  const result = await pool.query(
    "UPDATE overture_role_assignments SET model_ref = $4 WHERE run_id = $1 AND project_id = $2 AND role_id = $3",
    [args.runId, args.projectId, args.roleId, args.modelRef],
  );
  if (result.rowCount !== 1) throw new OvertureConflictError("Overture role assignment is not available");
}

export async function readOvertureMessages(
  queryable: Queryable,
  runId: string,
  projectId: string,
  conversationId: string,
  afterCursor = "0",
): Promise<ReadonlyArray<OvertureMessage>> {
  const boundary = await queryable.query("SELECT 1 FROM overture_runs WHERE run_id = $1 AND project_id = $2 AND conversation_id = $3", [
    runId,
    projectId,
    conversationId,
  ]);
  if (boundary.rowCount !== 1) throw new OvertureRunNotFoundError("Overture run not found");
  const result = await queryable.query<MessageRow>(
    "SELECT message_id, run_id, conversation_id, project_id, message_cursor, turn_id, actor_kind, actor_id, model_ref, content, created_at FROM overture_messages WHERE run_id = $1 AND project_id = $2 AND conversation_id = $3 AND message_cursor > $4::bigint ORDER BY message_cursor ASC",
    [runId, projectId, conversationId, afterCursor],
  );
  return result.rows.map((row) =>
    OvertureMessageSchema.parse({
      messageId: row.message_id,
      runId: row.run_id,
      conversationId: row.conversation_id,
      projectId: row.project_id,
      turnId: row.turn_id,
      cursor: row.message_cursor,
      actor: row.actor_kind === "role" ? row.actor_id : row.actor_kind,
      modelRef: row.model_ref,
      content: row.content,
      createdAt: iso(row.created_at),
    }),
  );
}

export async function readOvertureEvents(
  queryable: Queryable,
  runId: string,
  projectId: string,
  conversationId: string,
  afterCursor = "0",
): Promise<ReadonlyArray<import("@maestro/contracts").OvertureEvent>> {
  const boundary = await queryable.query("SELECT 1 FROM overture_runs WHERE run_id = $1 AND project_id = $2 AND conversation_id = $3", [
    runId,
    projectId,
    conversationId,
  ]);
  if (boundary.rowCount !== 1) throw new OvertureRunNotFoundError("Overture run not found");
  const result = await queryable.query<EventRow>(
    "SELECT e.event_id, e.run_id, e.project_id, e.cursor, e.event_type, e.payload, e.occurred_at FROM overture_events e JOIN overture_runs r ON r.run_id = e.run_id AND r.project_id = e.project_id WHERE e.run_id = $1 AND e.project_id = $2 AND r.conversation_id = $3 AND e.cursor > $4::bigint ORDER BY e.cursor ASC",
    [runId, projectId, conversationId, afterCursor],
  );
  return result.rows.map((row) =>
    OvertureEventSchema.parse({
      eventId: row.event_id,
      runId: row.run_id,
      projectId: row.project_id,
      cursor: row.cursor,
      eventType: row.event_type,
      payload: row.payload,
      createdAt: iso(row.occurred_at),
    }),
  );
}

export async function readOverturePlanManifest(
  pool: Queryable,
  runId: string,
  projectId: string,
  conversationId: string,
): Promise<OverturePlanManifest> {
  const boundary = await pool.query("SELECT 1 FROM overture_runs WHERE run_id = $1 AND project_id = $2 AND conversation_id = $3", [
    runId,
    projectId,
    conversationId,
  ]);
  if (boundary.rowCount !== 1) throw new OvertureRunNotFoundError("Overture run not found");
  const documents = await readPlanDocuments(pool, runId, projectId);
  const manifest = buildOverturePlanManifest({ projectId, runId, documents });
  const stored = await pool.query<{ manifest_hash: string }>(
    "SELECT manifest_hash FROM overture_manifest_revisions WHERE run_id = $1 AND project_id = $2 ORDER BY version DESC LIMIT 1",
    [runId, projectId],
  );
  if (stored.rowCount === 1 && stored.rows[0]!.manifest_hash.trim() !== manifest.manifestHash)
    throw new OvertureIntegrityError(`Overture plan manifest hash mismatch: ${runId}`);
  return manifest;
}

async function readPlanDocuments(queryable: Queryable, runId: string, projectId: string): Promise<OverturePlanDocument[]> {
  const result = await queryable.query<PlanRow>(
    "SELECT DISTINCT ON (d.document_id) d.document_id, d.run_id, d.project_id, d.path, d.kind, r.version, r.content, r.content_hash, r.source_refs, r.dependencies FROM overture_plan_documents d JOIN overture_plan_revisions r ON r.document_id = d.document_id AND r.run_id = d.run_id AND r.project_id = d.project_id WHERE d.run_id = $1 AND d.project_id = $2 ORDER BY d.document_id, r.version DESC",
    [runId, projectId],
  );
  return result.rows.map((row) => toPlanDocument(row));
}

async function readRunWithinTransaction(
  queryable: Queryable,
  runId: string,
  projectId: string,
  conversationId: string,
): Promise<OvertureRun | undefined> {
  const result = await queryable.query<RunRow>(
    "SELECT run_id, conversation_id, project_id, goal_id, execution_phase, task_contract_ref, task_contract_id, state, version, role_taxonomy_version, plan_manifest_hash FROM overture_runs WHERE run_id = $1 AND project_id = $2 AND conversation_id = $3",
    [runId, projectId, conversationId],
  );
  if (result.rowCount !== 1) return undefined;
  const row = result.rows[0]!;
  const roles = await queryable.query<RoleRow>(
    "SELECT role_id, status, model_ref FROM overture_role_assignments WHERE run_id = $1 AND project_id = $2 ORDER BY array_position(ARRAY['conversation-lead', 'architecture-analyst', 'external-research-scout', 'security-evaluator', 'design-mock-specialist', 'task-editor'], role_id)",
    [runId, projectId],
  );
  return OvertureRunSchema.parse({
    runId: row.run_id,
    conversationId: row.conversation_id,
    projectId: row.project_id,
    goalId: null,
    executionPhase: row.execution_phase,
    taskContractRef: row.task_contract_ref,
    taskContractId: row.task_contract_id,
    state: row.state,
    version: Number(row.version),
    roleTaxonomyVersion: row.role_taxonomy_version,
    planManifestHash: row.plan_manifest_hash?.trim() ?? null,
    roles: roles.rows.map((role) => ({ roleId: role.role_id, status: role.status, modelRef: role.model_ref })),
  });
}

async function appendEvent(
  client: PoolClient,
  args: {
    readonly runId: string;
    readonly projectId: string;
    readonly commandId: string;
    readonly eventType: string;
    readonly payload: Record<string, unknown>;
  },
): Promise<void> {
  const payload = JSON.stringify(args.payload);
  const inserted = await client.query<{ event_id: string }>(
    "INSERT INTO overture_events (event_id, run_id, project_id, event_type, payload, command_id) VALUES ($1, $2, $3, $4, $5::jsonb, $6) ON CONFLICT (command_id) DO NOTHING RETURNING event_id",
    [randomUUID(), args.runId, args.projectId, args.eventType, payload, args.commandId],
  );
  if (inserted.rowCount !== 1) {
    const existing = await client.query<{
      event_id: string;
      run_id: string;
      project_id: string;
      event_type: string;
      payload: Record<string, unknown>;
    }>("SELECT event_id, run_id, project_id, event_type, payload FROM overture_events WHERE command_id = $1 FOR UPDATE", [args.commandId]);
    const row = existing.rows[0];
    if (
      row === undefined ||
      row.run_id !== args.runId ||
      row.project_id !== args.projectId ||
      row.event_type !== args.eventType ||
      canonicalJson(row.payload) !== canonicalJson(args.payload)
    )
      throw new OvertureConflictError("Overture command identity was reused with different event content");
    return;
  }
  await client.query(
    "INSERT INTO overture_outbox (outbox_id, event_id, run_id, project_id, event_type, payload, status) VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'pending') ON CONFLICT (event_id) DO NOTHING",
    [randomUUID(), inserted.rows[0]!.event_id, args.runId, args.projectId, args.eventType, payload],
  );
}

function assertSafeContent(content: string): void {
  if (!isSafeOvertureText(content))
    throw new OvertureIntegrityError("Overture content is invalid or contains prohibited sensitive or raw model material");
}
function assertContentHash(content: string, contentHash: string): void {
  assertSafeContent(content);
  if (overturePlanContentHash(content) !== contentHash) throw new OvertureIntegrityError("Overture content hash mismatch");
}
function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}
function toMessage(row: MessageRow): OvertureMessage {
  return OvertureMessageSchema.parse({
    messageId: row.message_id,
    runId: row.run_id,
    conversationId: row.conversation_id,
    projectId: row.project_id,
    turnId: row.turn_id,
    cursor: row.message_cursor,
    actor: row.actor_kind === "role" ? row.actor_id : row.actor_kind,
    modelRef: row.model_ref,
    content: row.content,
    createdAt: iso(row.created_at),
  });
}
function toArtifact(row: ArtifactRow): OvertureArtifact {
  if (overturePlanContentHash(row.content) !== row.content_hash.trim())
    throw new OvertureIntegrityError(`Overture artifact hash mismatch: ${row.artifact_id}`);
  return OvertureArtifactSchema.parse({
    artifactId: row.artifact_id,
    runId: row.run_id,
    projectId: row.project_id,
    kind: row.kind,
    title: row.title,
    content: row.content,
    contentHash: row.content_hash.trim(),
    sourceRefs: row.source_refs,
  });
}
function toClarification(row: ClarificationRow): OvertureClarification {
  return OvertureClarificationSchema.parse({
    clarificationId: row.clarification_id,
    runId: row.run_id,
    projectId: row.project_id,
    question: row.question,
    answer: row.answer,
    answerCommandId: row.answer_command_id,
    status: row.status,
    commandId: row.command_id,
  });
}
function toPlanDocument(row: PlanRow): OverturePlanDocument {
  if (overturePlanContentHash(row.content) !== row.content_hash.trim())
    throw new OvertureIntegrityError(`Overture plan hash mismatch: ${row.document_id}`);
  return OverturePlanDocumentSchema.parse({
    documentId: row.document_id,
    projectId: row.project_id,
    runId: row.run_id,
    path: row.path,
    kind: row.kind,
    version: Number(row.version),
    content: row.content,
    contentHash: row.content_hash.trim(),
    sourceRefs: row.source_refs,
    dependencies: row.dependencies,
  });
}
