import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./test-migrations.js";
import { bootstrapPermanentOrganization } from "./organization.js";
import { bootstrapLocalOperator } from "./auth.js";
import { grantProjectMembership, grantProjectRole } from "./project-membership.js";
import { getChannel, postChannelMessage } from "./channel.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

async function insertGoal(pool: Pool, projectId: string, goalId: string, departmentId = "engineering", existingContractId?: string) {
  const contractId = existingContractId ?? randomUUID();
  await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
  await pool.query("INSERT INTO task_contracts (contract_id, schema_version, version, content, content_hash, launch_state) VALUES ($1, 1, 1, '{}'::jsonb, $2, 'launched')", [contractId, "a".repeat(64)]);
  await pool.query("INSERT INTO goal_head_participations (goal_id, department_id, head_role_id, contract_id, status, active_session_ref) VALUES ($1, $2, $3, $4, 'active', $5)", [goalId, departmentId, `head:${departmentId}`, contractId, `session:${departmentId}`]);
}

describeDatabase("channel persistence", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  beforeAll(async () => { await applyAllMigrations(pool); await bootstrapPermanentOrganization(pool); });
  beforeEach(async () => {
    await pool.query("TRUNCATE goals, channel_messages, channels, task_contracts, goal_head_participations, local_operator_credentials, local_operators CASCADE");
    await bootstrapPermanentOrganization(pool);
  });
  afterAll(async () => { await pool.end(); });

  it("persists Department messages and returns them in insertion order after a fresh pool read", async () => {
    const projectId = randomUUID(), goalId = randomUUID();
    await insertGoal(pool, projectId, goalId);
    const { operatorId } = await bootstrapLocalOperator(pool, { secret: "channel-writer" });
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectRole(pool, operatorId, projectId, "head-engineering");
    const selector = { kind: "department" as const, channelId: "engineering" };
    await postChannelMessage(pool, { operatorId, projectId, goalId, selector, content: "first", messageId: randomUUID() });
    await postChannelMessage(pool, { operatorId, projectId, goalId, selector, content: "second", messageId: randomUUID() });

    const restarted = new Pool({ connectionString: databaseUrl });
    try {
      const read = await getChannel(restarted, { operatorId, projectId, goalId, selector });
      expect(read.messages.map((message) => message.content)).toEqual(["first", "second"]);
      expect(read.members.some((member) => member.identityId === "head:engineering")).toBe(true);
    } finally { await restarted.end(); }
  });

  it("derives membership from the live Head/Worker roster on every read", async () => {
    const projectId = randomUUID(), goalId = randomUUID();
    await insertGoal(pool, projectId, goalId);
    const { operatorId } = await bootstrapLocalOperator(pool, { secret: "channel-reader" });
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectRole(pool, operatorId, projectId, "head-engineering");
    const selector = { kind: "department" as const, channelId: "engineering" };
    expect((await getChannel(pool, { operatorId, projectId, goalId, selector })).members.some((member) => member.identityId === "head:engineering")).toBe(true);
    await pool.query("UPDATE goal_head_participations SET status = 'sleeping', active_session_ref = NULL WHERE goal_id = $1 AND department_id = 'engineering'", [goalId]);
    expect((await getChannel(pool, { operatorId, projectId, goalId, selector })).members.some((member) => member.identityId === "head:engineering")).toBe(false);
  });

  it("removes a Worker from the live channel roster when its durable status becomes terminal", async () => {
    const projectId = randomUUID(), goalId = randomUUID(), contractId = randomUUID(), councilId = randomUUID(), planHash = "b".repeat(64), workerId = randomUUID();
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
    await pool.query("INSERT INTO task_contracts (contract_id, schema_version, version, content, content_hash, launch_state) VALUES ($1, 1, 1, '{}'::jsonb, $2, 'launched')", [contractId, "a".repeat(64)]);
    await pool.query("INSERT INTO goal_head_participations (goal_id, department_id, head_role_id, contract_id, status, active_session_ref) VALUES ($1, 'engineering', 'head:engineering', $2, 'active', 'session:engineering')", [goalId, contractId]);
    await pool.query("INSERT INTO head_councils (council_id, goal_id, contract_id, brief_deadline, state, snapshot_hash, snapshot_payload) VALUES ($1, $2, $3, clock_timestamp() + interval '1 hour', 'collecting', $4, '{}'::jsonb)", [councilId, goalId, contractId, "c".repeat(64)]);
    await pool.query("INSERT INTO council_participants (council_id, department_id, head_role_id, session_ref) VALUES ($1, 'engineering', 'head:engineering', 'session:engineering')", [councilId]);
    await pool.query("INSERT INTO department_plans (council_id, department_id, project_id, goal_id, head_role_id, council_snapshot_hash, decision_packet_hash, contract_id, contract_version, contract_content_hash, current_version, substance, content_hash) VALUES ($1, 'engineering', $2, $3, 'head:engineering', $4, $5, $6, 1, $7, 1, '{}'::jsonb, $8)", [councilId, projectId, goalId, "c".repeat(64), "d".repeat(64), contractId, "a".repeat(64), planHash]);
    await pool.query("INSERT INTO mission_bundles (bundle_id, council_id, department_id, plan_version, plan_content_hash, item_id, parent_ref, substance, content_hash) VALUES ($1, $2, 'engineering', 1, $3, 'item-1', 'plan', '{}'::jsonb, $4)", [randomUUID(), councilId, planHash, "e".repeat(64)]);
    await pool.query("INSERT INTO workers (worker_id, council_id, department_id, plan_version, item_id, bundle_content_hash, attempt, execution_ref, invocation_ref, status) VALUES ($1, $2, 'engineering', 1, 'item-1', $3, 1, 'execution', 'invocation', 'running')", [workerId, councilId, "e".repeat(64)]);
    const { operatorId } = await bootstrapLocalOperator(pool, { secret: "worker-roster" });
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectRole(pool, operatorId, projectId, "head-engineering");
    const selector = { kind: "department" as const, channelId: "engineering" };
    expect((await getChannel(pool, { operatorId, projectId, goalId, selector })).members.some((member) => member.identityId === workerId)).toBe(true);
    await pool.query("UPDATE workers SET status = 'succeeded' WHERE worker_id = $1", [workerId]);
    expect((await getChannel(pool, { operatorId, projectId, goalId, selector })).members.some((member) => member.identityId === workerId)).toBe(false);
  });

  it("derives each organization and Encore channel from its own live roster scope", async () => {
    const projectId = randomUUID(), goalId = randomUUID(), contractId = randomUUID();
    await insertGoal(pool, projectId, goalId, "engineering", contractId);
    await pool.query("INSERT INTO goal_head_participations (goal_id, department_id, head_role_id, contract_id, status, active_session_ref) VALUES ($1, 'product', 'head:product', $2, 'active', 'session:product')", [goalId, contractId]);
    const { operatorId } = await bootstrapLocalOperator(pool, { secret: "channel-scope-roster" });
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectRole(pool, operatorId, projectId, "concertmaster");
    await grantProjectRole(pool, operatorId, projectId, "encore-council-1");
    await grantProjectRole(pool, operatorId, projectId, "encore-metronome");
    const general = await getChannel(pool, { operatorId, projectId, goalId, selector: { kind: "organization", channelId: "general" } });
    const headCouncil = await getChannel(pool, { operatorId, projectId, goalId, selector: { kind: "organization", channelId: "head-council" } });
    const encoreCouncil = await getChannel(pool, { operatorId, projectId, goalId, selector: { kind: "encore", channelId: "encore-council" } });
    const metronome = await getChannel(pool, { operatorId, projectId, goalId, selector: { kind: "encore", channelId: "metronome" } });
    expect(general.members.map((member) => member.identityId)).toEqual(expect.arrayContaining(["head:engineering", "head:product", "concertmaster"]));
    expect(headCouncil.members.map((member) => member.identityId)).toEqual(expect.arrayContaining(["head:engineering", "head:product", "concertmaster"]));
    expect(headCouncil.members.every((member) => member.identityKind !== "worker")).toBe(true);
    expect(encoreCouncil.members.map((member) => member.identityId)).toEqual(["encore-council-1", "encore-council-2", "encore-council-3"]);
    expect(encoreCouncil.members.every((member) => member.identityKind === "role" && member.departmentId === null)).toBe(true);
    expect(metronome.members.map((member) => member.identityId)).toEqual(["encore-metronome"]);
  });

  it("uses one schema for organization and Encore channels", async () => {
    const projectId = randomUUID(), goalId = randomUUID();
    await insertGoal(pool, projectId, goalId);
    const { operatorId } = await bootstrapLocalOperator(pool, { secret: "channel-scopes" });
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectRole(pool, operatorId, projectId, "concertmaster");
    await grantProjectRole(pool, operatorId, projectId, "encore-metronome");
    const roleMessageId = randomUUID();
    const roleRequest = { operatorId, projectId, goalId, selector: { kind: "encore" as const, channelId: "metronome" as const }, content: "durable metronome", messageId: roleMessageId, author: { kind: "role" as const, id: "encore-metronome" }, authorProof: { issuer: "channel-runtime" as const, author: { kind: "role" as const, id: "encore-metronome" } } };
    const roleMessage = await postChannelMessage(pool, roleRequest);
    await expect(postChannelMessage(pool, roleRequest)).resolves.toEqual(roleMessage);
    await expect(postChannelMessage(pool, { operatorId, projectId, goalId, selector: { kind: "organization", channelId: "general" }, content: "wrong scope", messageId: randomUUID(), author: { kind: "role", id: "encore-metronome" }, authorProof: { issuer: "channel-runtime", author: { kind: "role", id: "encore-metronome" } } })).rejects.toThrow(/scope/);
    // The Overture conversation lead chairs #head-council and speaks nowhere else.
    const lead = { kind: "role" as const, id: "conversation-lead" };
    await postChannelMessage(pool, { operatorId, projectId, goalId, selector: { kind: "organization", channelId: "head-council" }, content: "Opening the meeting", messageId: randomUUID(), author: lead, authorProof: { issuer: "channel-runtime", author: lead } });
    await expect(postChannelMessage(pool, { operatorId, projectId, goalId, selector: { kind: "organization", channelId: "general" }, content: "wrong scope", messageId: randomUUID(), author: lead, authorProof: { issuer: "channel-runtime", author: lead } })).rejects.toThrow(/scope/);
    for (const selector of [
      { kind: "organization" as const, channelId: "general" },
      { kind: "organization" as const, channelId: "head-council" },
      { kind: "encore" as const, channelId: "encore-council" },
      { kind: "encore" as const, channelId: "metronome" },
    ]) await postChannelMessage(pool, { operatorId, projectId, goalId, selector, content: selector.channelId, messageId: randomUUID() });
    expect((await pool.query("SELECT count(*)::int AS count FROM channels WHERE project_id = $1", [projectId])).rows[0]!.count).toBe(4);
  });

  it("allows the existing Goal-owned cascade reset path while rejecting direct message truncation", async () => {
    const projectId = randomUUID(), goalId = randomUUID();
    await insertGoal(pool, projectId, goalId);
    const { operatorId } = await bootstrapLocalOperator(pool, { secret: "channel-reset" });
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectRole(pool, operatorId, projectId, "head-engineering");
    await postChannelMessage(pool, { operatorId, projectId, goalId, selector: { kind: "department", channelId: "engineering" }, content: "reset me", messageId: randomUUID() });
    await expect(pool.query("TRUNCATE channel_messages")).rejects.toThrow(/append-only|truncat|forbidden/i);
    await expect(pool.query("TRUNCATE goals CASCADE")).resolves.toMatchObject({ command: "TRUNCATE" });
  });

  it("replays an idempotent message after the Goal ends without accepting new content", async () => {
    const projectId = randomUUID(), goalId = randomUUID();
    await insertGoal(pool, projectId, goalId);
    const { operatorId } = await bootstrapLocalOperator(pool, { secret: "channel-replay-after-close" });
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectRole(pool, operatorId, projectId, "head-engineering");
    const selector = { kind: "department" as const, channelId: "engineering" };
    const messageId = randomUUID();
    const original = await postChannelMessage(pool, { operatorId, projectId, goalId, selector, content: "replay after close", messageId });
    await pool.query("UPDATE goals SET state = 'succeeded' WHERE goal_id = $1", [goalId]);
    await expect(postChannelMessage(pool, { operatorId, projectId, goalId, selector, content: "replay after close", messageId })).resolves.toEqual(original);
    await expect(postChannelMessage(pool, { operatorId, projectId, goalId, selector, content: "changed after close", messageId })).rejects.toThrow(/idempotency|closed/);
  });

  it("rejects a non-operator author without an explicit internal author proof", async () => {
    const projectId = randomUUID(), goalId = randomUUID();
    await insertGoal(pool, projectId, goalId);
    const { operatorId } = await bootstrapLocalOperator(pool, { secret: "channel-service-author" });
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectRole(pool, operatorId, projectId, "head-engineering");
    await expect(postChannelMessage(pool, {
      operatorId,
      projectId,
      goalId,
      selector: { kind: "department", channelId: "engineering" },
      content: "forged head",
      messageId: randomUUID(),
      author: { kind: "head", id: "head:engineering" },
    } as never)).rejects.toThrow(/internal author proof/i);
  });

  it("rejects a direct database message attributed to an operator without the project's active role", async () => {
    const projectId = randomUUID(), goalId = randomUUID();
    await insertGoal(pool, projectId, goalId);
    const { operatorId } = await bootstrapLocalOperator(pool, { secret: "channel-db-author" });
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectRole(pool, operatorId, projectId, "head-engineering");
    const message = await postChannelMessage(pool, { operatorId, projectId, goalId, selector: { kind: "department", channelId: "engineering" }, content: "valid", messageId: randomUUID() });
    const rogue = await bootstrapLocalOperator(pool, { secret: "channel-db-rogue" });
    await expect(pool.query(
      "INSERT INTO channel_messages (message_id, channel_id, author_kind, author_id, content, idempotency_key) VALUES ($1, $2, 'operator', $3, 'forged', $1)",
      [randomUUID(), message.channelId, rogue.operatorId],
    )).rejects.toThrow(/author|membership|role|active/i);
  });

  it("does not let a caller-controlled search_path shadow channel authorization tables", async () => {
    const projectId = randomUUID(), goalId = randomUUID();
    await insertGoal(pool, projectId, goalId);
    const { operatorId } = await bootstrapLocalOperator(pool, { secret: "channel-search-path-owner" });
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectRole(pool, operatorId, projectId, "head-engineering");
    const channel = await postChannelMessage(pool, {
      operatorId,
      projectId,
      goalId,
      selector: { kind: "department", channelId: "engineering" },
      content: "create channel",
      messageId: randomUUID(),
    });

    const shadowSchema = `channel_shadow_${randomUUID().replaceAll("-", "")}`;
    const rogueOperatorId = randomUUID();
    const shadowClient = await pool.connect();
    let shadowError: unknown;
    try {
      await shadowClient.query(`CREATE SCHEMA "${shadowSchema}"`);
      await shadowClient.query(`
        CREATE TABLE "${shadowSchema}".channels (channel_id uuid, project_id uuid, goal_id uuid, scope_kind text, scope_id text);
        CREATE TABLE "${shadowSchema}".goals (goal_id uuid, state text);
        CREATE TABLE "${shadowSchema}".local_operators (operator_id uuid, active boolean);
        CREATE TABLE "${shadowSchema}".operator_project_memberships (operator_id uuid, project_id uuid, active boolean);
        CREATE TABLE "${shadowSchema}".operator_project_roles (operator_id uuid, project_id uuid, role_id text, active boolean);
      `);
      await shadowClient.query(`INSERT INTO "${shadowSchema}".channels VALUES ($1, $2, $3, 'department', 'engineering')`, [channel.channelId, projectId, goalId]);
      await shadowClient.query(`INSERT INTO "${shadowSchema}".goals VALUES ($1, 'active')`, [goalId]);
      await shadowClient.query(`INSERT INTO "${shadowSchema}".local_operators VALUES ($1, true)`, [rogueOperatorId]);
      await shadowClient.query(`INSERT INTO "${shadowSchema}".operator_project_memberships VALUES ($1, $2, true)`, [rogueOperatorId, projectId]);
      await shadowClient.query(`INSERT INTO "${shadowSchema}".operator_project_roles VALUES ($1, $2, 'head-engineering', true)`, [rogueOperatorId, projectId]);
      await shadowClient.query("BEGIN");
      await shadowClient.query(`SET LOCAL search_path = "${shadowSchema}", public`);
      await shadowClient.query(
        "INSERT INTO public.channel_messages (message_id, channel_id, author_kind, author_id, content, idempotency_key) VALUES ($1, $2, 'operator', $3, 'shadow forged', $1)",
        [randomUUID(), channel.channelId, rogueOperatorId],
      );
      await shadowClient.query("ROLLBACK");
    } catch (error) {
      shadowError = error;
      await shadowClient.query("ROLLBACK").catch(() => undefined);
    } finally {
      shadowClient.release();
      await pool.query(`DROP SCHEMA IF EXISTS "${shadowSchema}" CASCADE`);
    }
    expect(shadowError).toBeDefined();
    const functionDefinition = await pool.query<{ definition: string }>(
      "SELECT pg_get_functiondef(oid) AS definition FROM pg_proc WHERE proname = 'assert_channel_message_author' ORDER BY oid DESC LIMIT 1",
    );
    expect(functionDefinition.rows[0]?.definition).toContain("FOR SHARE");
  });

  it("keeps durable channel identities append-only, including empty channels", async () => {
    const projectId = randomUUID(), goalId = randomUUID(), channelId = randomUUID();
    await insertGoal(pool, projectId, goalId);
    await pool.query(
      "INSERT INTO channels (channel_id, project_id, goal_id, scope_kind, scope_id, department_id, display_name) VALUES ($1, $2, $3, 'organization', 'general', NULL, '#general')",
      [channelId, projectId, goalId],
    );
    await expect(pool.query("UPDATE channels SET display_name = 'tampered' WHERE channel_id = $1", [channelId])).rejects.toThrow(/immutable|append-only/i);
    await expect(pool.query("DELETE FROM channels WHERE channel_id = $1", [channelId])).rejects.toThrow(/immutable|append-only/i);
    await expect(pool.query("TRUNCATE channels")).rejects.toThrow(/truncat|forbidden|append-only/i);
  });

  it("rejects writes after the Goal ends and keeps message history append-only", async () => {
    const projectId = randomUUID(), goalId = randomUUID();
    await insertGoal(pool, projectId, goalId);
    const { operatorId } = await bootstrapLocalOperator(pool, { secret: "channel-closed" });
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectRole(pool, operatorId, projectId, "head-engineering");
    const selector = { kind: "department" as const, channelId: "engineering" };
    const beforeClose = await postChannelMessage(pool, { operatorId, projectId, goalId, selector, content: "before close", messageId: randomUUID() });
    await pool.query("UPDATE goals SET state = 'succeeded' WHERE goal_id = $1", [goalId]);
    await expect(postChannelMessage(pool, { operatorId, projectId, goalId, selector, content: "after close", messageId: randomUUID() })).rejects.toThrow(/closed/);
    await expect(pool.query(
      "INSERT INTO channel_messages (message_id, channel_id, author_kind, author_id, content, idempotency_key) VALUES ($1, $2, 'operator', $3, 'direct after close', $1)",
      [randomUUID(), beforeClose.channelId, operatorId],
    )).rejects.toThrow(/closed|ended/i);
    await expect(pool.query("UPDATE channel_messages SET content = 'rewritten'")).rejects.toThrow(/append-only/);
    await expect(pool.query("TRUNCATE channel_messages")).rejects.toThrow(/append-only|forbidden|truncat/i);
  });

  it("rejects posting without the channel's active project role", async () => {
    const projectId = randomUUID(), goalId = randomUUID();
    await insertGoal(pool, projectId, goalId);
    const { operatorId } = await bootstrapLocalOperator(pool, { secret: "channel-forbidden" });
    await grantProjectMembership(pool, operatorId, projectId);
    await expect(postChannelMessage(pool, { operatorId, projectId, goalId, selector: { kind: "department", channelId: "engineering" }, content: "nope", messageId: randomUUID() })).rejects.toThrow(/active .* role/);
  });
});
