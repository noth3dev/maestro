import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  ChannelMessageSchema,
  ChannelSelectorSchema,
  channelRoleIds,
  ChannelAuthorSchema,
  type ChannelAuthor,
  type ChannelMessage,
  type ChannelSelector,
} from "@maestro/domain";
import type { ChannelMember, ChannelRead } from "@maestro/contracts";
import { GoalStateSchema, UuidSchema } from "@maestro/contracts";
import { assertProjectMembership, ProjectRoleRequiredError } from "./project-membership.js";

type Queryable = Pick<Pool | PoolClient, "query">;

export interface ChannelRequest {
  readonly operatorId: string;
  readonly projectId: string;
  readonly goalId: string;
  readonly selector: ChannelSelector;
}

export interface ChannelInternalAuthorProof {
  readonly issuer: "channel-runtime";
  readonly author: ChannelAuthor;
}

export interface PostChannelMessageRequest extends ChannelRequest {
  readonly content: string;
  readonly messageId?: string;
  /** Internal agent posts require a matching runtime proof; HTTP never accepts either field. */
  readonly author?: ChannelAuthor;
  readonly authorProof?: ChannelInternalAuthorProof;
}

export class ChannelError extends Error {}
export class ChannelNotFoundError extends ChannelError {}
export class ChannelConflictError extends ChannelError {}
export class ChannelClosedError extends ChannelError {}

interface ChannelRow {
  channel_id: string;
  project_id: string;
  goal_id: string;
  scope_kind: ChannelSelector["kind"];
  scope_id: string;
  display_name: string;
  goal_state: string;
}
interface MessageRow {
  message_id: string;
  message_sequence: string;
  channel_id: string;
  author_kind: ChannelMessage["author"]["kind"];
  author_id: string;
  content: string;
  created_at: Date;
}

function parseRequest(request: ChannelRequest): ChannelRequest {
  const selector = ChannelSelectorSchema.parse(request.selector);
  UuidSchema.parse(request.projectId);
  UuidSchema.parse(request.goalId);
  if (request.operatorId.trim() === "") throw new ChannelError("Channel operator identity must be non-empty");
  return { ...request, selector };
}

function displayName(selector: ChannelSelector): string {
  return `#${selector.channelId}`;
}

async function assertCanPost(pool: Queryable, request: ChannelRequest): Promise<void> {
  const roles = channelRoleIds(request.selector);
  const result = await pool.query<{ role_id: string }>(
    `SELECT r.role_id FROM operator_project_roles r
       JOIN operator_project_memberships m ON m.operator_id = r.operator_id AND m.project_id = r.project_id AND m.active = true
      WHERE r.operator_id = $1 AND r.project_id = $2 AND r.active = true AND r.role_id = ANY($3::text[])
      ORDER BY r.role_id LIMIT 1 FOR SHARE`,
    [request.operatorId, request.projectId, roles],
  );
  if (result.rowCount !== 1) throw new ProjectRoleRequiredError(request.operatorId, request.projectId, roles[0]!);
}

function deterministicChannelId(request: ChannelRequest): string {
  const bytes = createHash("sha256").update(`${request.projectId}:${request.goalId}:${request.selector.kind}:${request.selector.channelId}`, "utf8").digest();
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function resolveChannel(client: Queryable, request: ChannelRequest): Promise<ChannelRow> {
  const goal = await client.query<{ project_id: string; state: string }>(
    "SELECT project_id, state FROM goals WHERE goal_id = $1 FOR SHARE", [request.goalId],
  );
  if (goal.rowCount !== 1 || goal.rows[0]!.project_id !== request.projectId) throw new ChannelNotFoundError("Goal was not found for this project");
  const result = await client.query<ChannelRow>(
    `SELECT c.channel_id, c.project_id, c.goal_id, c.scope_kind, c.scope_id, c.display_name, g.state AS goal_state
       FROM channels c JOIN goals g ON g.goal_id = c.goal_id
      WHERE c.project_id = $1 AND c.goal_id = $2 AND c.scope_kind = $3 AND c.scope_id = $4`,
    [request.projectId, request.goalId, request.selector.kind, request.selector.channelId],
  );
  if (result.rowCount === 1) return result.rows[0]!;
  return {
    channel_id: deterministicChannelId(request), project_id: request.projectId, goal_id: request.goalId,
    scope_kind: request.selector.kind, scope_id: request.selector.channelId,
    display_name: displayName(request.selector), goal_state: goal.rows[0]!.state,
  };
}

function toMessage(row: MessageRow): ChannelMessage {
  return ChannelMessageSchema.parse({
    messageId: row.message_id,
    channelId: row.channel_id,
    sequence: row.message_sequence,
    author: { kind: row.author_kind, id: row.author_id },
    content: row.content,
    createdAt: row.created_at.toISOString(),
  });
}

async function listMembers(client: Queryable, request: ChannelRequest): Promise<readonly ChannelMember[]> {
  const includeHeads = request.selector.kind !== "encore";
  const includeWorkers = request.selector.kind === "department"
    || request.selector.kind === "organization" && request.selector.channelId === "general";
  const departmentParams = request.selector.kind === "department" ? [request.goalId, request.selector.channelId] : [request.goalId];
  const heads = includeHeads ? await client.query<ChannelMember>(
    `SELECT p.head_role_id AS "identityId", 'head' AS "identityKind",
            d.display_name || ' Head' AS "displayName", p.department_id AS "departmentId", p.status AS status
       FROM goal_head_participations p
       JOIN departments d ON d.department_id = p.department_id
      WHERE p.goal_id = $1 AND p.status = 'active' AND p.active_session_ref IS NOT NULL
        ${request.selector.kind === "department" ? "AND p.department_id = $2" : ""}
      ORDER BY p.department_id, p.head_role_id`, departmentParams,
  ) : { rows: [] as ChannelMember[] };
  const workers = includeWorkers ? await client.query<ChannelMember>(
    `SELECT w.worker_id::text AS "identityId", 'worker' AS "identityKind",
            w.item_id AS "displayName", w.department_id AS "departmentId", w.status AS status
       FROM workers w
       JOIN head_councils hc ON hc.council_id = w.council_id
      WHERE hc.goal_id = $1 AND w.status IN ('spawned', 'running', 'awaiting_repair', 'unknown')
        ${request.selector.kind === "department" ? "AND w.department_id = $2" : ""}
      ORDER BY w.department_id, w.worker_id`, departmentParams,
  ) : { rows: [] as ChannelMember[] };
  const roleIds = request.selector.kind === "organization"
    ? ["concertmaster"]
    : request.selector.kind === "encore" && request.selector.channelId === "encore-council"
      ? ["encore-council-1", "encore-council-2", "encore-council-3"]
      : request.selector.kind === "encore" ? ["encore-metronome"] : [];
  const roles = roleIds.length === 0 ? { rows: [] as ChannelMember[] } : await client.query<ChannelMember>(
    `SELECT role_id AS "identityId", 'role' AS "identityKind", display_name AS "displayName",
            department_id AS "departmentId", status
       FROM permanent_roles WHERE role_id = ANY($1::text[]) ORDER BY role_id`, [roleIds],
  );
  return [...heads.rows, ...workers.rows, ...roles.rows];
}

async function assertInternalAuthor(client: Queryable, channel: ChannelRow, author: ChannelAuthor): Promise<void> {
  let result;
  if (author.kind === "head") {
    result = await client.query(
      `SELECT 1
         FROM goal_head_participations
        WHERE goal_id = $1 AND head_role_id = $2 AND status = 'active' AND active_session_ref IS NOT NULL
          AND (( $3 = 'department' AND department_id = $4 ) OR $3 = 'organization')
        LIMIT 1`,
      [channel.goal_id, author.id, channel.scope_kind, channel.scope_id],
    );
  } else if (author.kind === "worker") {
    result = await client.query(
      `SELECT 1
         FROM workers w
         JOIN head_councils hc ON hc.council_id = w.council_id
        WHERE hc.goal_id = $1 AND w.worker_id::text = $2
          AND w.status IN ('spawned', 'running', 'awaiting_repair', 'unknown')
          AND (( $3 = 'department' AND w.department_id = $4 ) OR ( $3 = 'organization' AND $4 = 'general'))
        LIMIT 1`,
      [channel.goal_id, author.id, channel.scope_kind, channel.scope_id],
    );
  } else {
    result = await client.query(
      `SELECT 1
         FROM permanent_roles
        WHERE role_id = $1 AND status = 'standing'
          AND (
            ($2 = 'organization' AND $3 IN ('general', 'head-council') AND role_id = 'concertmaster')
            OR ($2 = 'encore' AND $3 = 'encore-council' AND role_id IN ('encore-council-1', 'encore-council-2', 'encore-council-3'))
            OR ($2 = 'encore' AND $3 = 'metronome' AND role_id = 'encore-metronome')
          )
        LIMIT 1`,
      [author.id, channel.scope_kind, channel.scope_id],
    );
  }
  if (result.rowCount !== 1) throw new ChannelError("Channel message internal author is outside the channel scope");
}

export async function getChannel(pool: Pool, request: ChannelRequest): Promise<ChannelRead> {
  const parsed = parseRequest(request);
  await assertProjectMembership(pool, parsed.operatorId, parsed.projectId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const channel = await resolveChannel(client, parsed);
    const [messages, members] = await Promise.all([
      client.query<MessageRow>(
        `SELECT message_id, message_sequence, channel_id, author_kind, author_id, content, created_at
           FROM channel_messages WHERE channel_id = $1 ORDER BY message_sequence ASC`, [channel.channel_id],
      ),
      listMembers(client, parsed),
    ]);
    await client.query("COMMIT");
    return {
      channel: { channelId: channel.channel_id, projectId: channel.project_id, goalId: channel.goal_id, state: GoalStateSchema.parse(channel.goal_state), kind: channel.scope_kind, scopeId: channel.scope_id, displayName: channel.display_name },
      messages: messages.rows.map(toMessage),
      members: [...members],
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function postChannelMessage(pool: Pool, request: PostChannelMessageRequest): Promise<ChannelMessage> {
  const parsed = parseRequest(request);
  const content = request.content.trim();
  if (content === "" || content.length > 64_000) throw new ChannelError("Channel message content is invalid");
  const author = ChannelAuthorSchema.parse(request.author ?? { kind: "operator", id: parsed.operatorId });
  if (author.kind === "operator") {
    if (author.id !== parsed.operatorId) throw new ChannelError("Channel operator author must match the authenticated operator");
    if (request.authorProof !== undefined) throw new ChannelError("Channel internal author proof is only valid for non-operator authors");
  } else {
    const proofAuthor = request.authorProof?.author === undefined ? undefined : ChannelAuthorSchema.safeParse(request.authorProof.author);
    if (request.authorProof?.issuer !== "channel-runtime" || !proofAuthor?.success
      || proofAuthor.data.kind !== author.kind || proofAuthor.data.id !== author.id) {
      throw new ChannelError("Channel internal author proof is required for non-operator authors");
    }
  }
  const messageId = UuidSchema.parse(request.messageId ?? randomUUID());
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await assertCanPost(client, parsed);
    const channel = await resolveChannel(client, parsed);
    const existingBeforeLifecycle = await client.query<MessageRow>(
      `SELECT message_id, message_sequence, channel_id, author_kind, author_id, content, created_at
         FROM channel_messages WHERE channel_id = $1 AND idempotency_key = $2`, [channel.channel_id, messageId],
    );
    if (existingBeforeLifecycle.rowCount === 1) {
      const message = toMessage(existingBeforeLifecycle.rows[0]!);
      if (message.author.kind !== author.kind || message.author.id !== author.id || message.content !== content) throw new ChannelConflictError("Channel message idempotency key was reused with different content");
      await client.query("COMMIT");
      return message;
    }
    if (author.kind !== "operator") await assertInternalAuthor(client, channel, author);
    if (["stopped", "succeeded", "failed"].includes(channel.goal_state)) throw new ChannelClosedError("Channel is closed because its Goal has ended");
    await client.query(
      `INSERT INTO channels (channel_id, project_id, goal_id, scope_kind, scope_id, department_id, display_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (project_id, goal_id, scope_kind, scope_id) DO NOTHING`,
      [channel.channel_id, parsed.projectId, parsed.goalId, parsed.selector.kind, parsed.selector.channelId, parsed.selector.kind === "department" ? parsed.selector.channelId : null, channel.display_name],
    );
    const inserted = await client.query<MessageRow>(
      `INSERT INTO channel_messages (message_id, channel_id, author_kind, author_id, content, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $1)
       ON CONFLICT DO NOTHING
       RETURNING message_id, message_sequence, channel_id, author_kind, author_id, content, created_at`,
      [messageId, channel.channel_id, author.kind, author.id, content],
    );
    if (inserted.rowCount === 1) { await client.query("COMMIT"); return toMessage(inserted.rows[0]!); }
    const existing = await client.query<MessageRow>(
      `SELECT message_id, message_sequence, channel_id, author_kind, author_id, content, created_at
         FROM channel_messages WHERE channel_id = $1 AND idempotency_key = $2`, [channel.channel_id, messageId],
    );
    if (existing.rowCount !== 1) throw new ChannelConflictError("Channel message retry could not be recovered");
    const message = toMessage(existing.rows[0]!);
    if (message.author.kind !== author.kind || message.author.id !== author.id || message.content !== content) throw new ChannelConflictError("Channel message idempotency key was reused with different content");
    await client.query("COMMIT");
    return message;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
