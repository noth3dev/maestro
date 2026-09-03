import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { applyAllMigrations } from "./test-migrations.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertValidDecisionPacket, freezeSealedSubmissionSnapshot, sealedSubmissionSnapshotHash, taskContractContentHash, type IndependentBrief, type TaskContractSubstance } from "@maestro/domain";
import { bootstrapPermanentOrganization } from "./organization.js";
import { acquireGoalLease } from "./commands.js";
import { CouncilBriefIdempotencyError, CouncilBriefsSealedError, CouncilProtocolError, createHeadCouncil, listCouncilProtocolEvents, markMissingCouncilParticipantsAbsent, readHeadCouncil, readRevealedCouncilBriefs, recordCouncilDecisionPacket, recordCouncilRound, revealCouncilBriefs, submitIndependentBrief } from "./council.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
function buildContractContent(projectId: string): TaskContractSubstance {
  return {
    desiredOutcome: "deliver safely",
    userVisibleBehavior: [], successCriteria: [], liveEvidence: [], scope: [], nonGoals: [], priorities: [], acceptableTradeoffs: [], constraints: [], knownEdgeCases: [],
    project: { projectId, repository: "repo", immutableBaseRevision: "base", dataBoundary: "local" },
    evidenceReferences: [], approvedPreviewReferences: [], expectedGroups: [], expectedDepartments: [], criticalActionExpectations: [], forbiddenEffects: [], environmentAssumptions: [], externalServiceAssumptions: [],
    budget: { ceiling: "1", reportingExpectations: [], stoppingConditions: [] },
  };
}
const brief: IndependentBrief = { interpretation: "safe outcome", contribution: "review", nonGoals: [], assumptions: [], evidenceGaps: [], risks: [], dependencies: [], proposedValidation: [], expectedWorkers: [], expectedCost: "1", expectedTime: "1", objectionsToLikelyAlternatives: [] };
const evidence = { references: [randomUUID(), randomUUID()] };
const context = (label: string) => ({ actorId: `actor:${label}`, sessionRef: `session:${label}`, commandId: randomUUID() });
const headContext = (departmentId: string) => ({ actorId: `head:${departmentId}`, sessionRef: `opaque:${departmentId}`, commandId: randomUUID() });

 describeDatabase("Head Council briefs with PostgreSQL", () => {
 const pool = new Pool({ connectionString: databaseUrl });
 async function setup(departments = ["product", "engineering"], briefDeadline = new Date(Date.now() + 60_000), snapshotEvidence = evidence) {
   const goalId = randomUUID(), contractId = randomUUID(), projectId = randomUUID();
   const contractContent = buildContractContent(projectId);
   await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
   await pool.query("INSERT INTO task_contracts (contract_id, schema_version, version, content, content_hash, launch_state) VALUES ($1, 1, 1, $2::jsonb, $3, 'launched')", [contractId, JSON.stringify(contractContent), taskContractContentHash(contractContent)]);
   for (const evidenceId of evidence.references) {
     await pool.query(
       "INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'test-result', 'text/plain', 'project_lifetime')",
       [evidenceId, randomUUID(), randomUUID(), projectId, goalId, "test", "0".repeat(64)],
     );
   }
   for (const departmentId of departments) await pool.query("INSERT INTO goal_head_participations (goal_id, department_id, head_role_id, contract_id, status, active_session_ref) VALUES ($1, $2, $3, $4, 'active', $5)", [goalId, departmentId, `head:${departmentId}`, contractId, `opaque:${departmentId}`]);
   const proof = await acquireGoalLease(pool, { goalId, ownerId: "test", leaseDurationMs: 60_000 });
   const council = await createHeadCouncil(pool, { goalId, contractId, briefDeadline, evidence: snapshotEvidence }, proof, context("secretary"));
   expect(/^[0-9a-f]{64}$/.test(council.snapshotHash)).toBe(true);
   return { goalId, contractId, projectId, proof, council };
 }
 beforeAll(async () => {
   await pool.query("DROP TABLE IF EXISTS council_protocol_events, council_round_contributions, council_rounds, independent_briefs, council_participants, head_councils, head_activation_edges, head_activation_attempts, goal_head_participations, task_contract_confirmations, task_contract_decisions, task_contracts, role_persona_axes, permanent_roles, departments, organization_groups, goal_leases, outbox, goal_events, command_receipts, goals CASCADE");
   await applyAllMigrations(pool);
 });
 beforeEach(async () => { await pool.query("TRUNCATE council_protocol_events, head_councils, goal_head_participations, task_contracts, evidence_records, goal_leases, outbox, goal_events, command_receipts, goals RESTART IDENTITY CASCADE"); await bootstrapPermanentOrganization(pool); });
 afterAll(async () => { await pool.end(); });

 it("stores and reloads the complete immutable snapshot, and seals/idempotently accepts briefs", async () => {
   const { council, proof, projectId } = await setup();
   expect(typeof council.snapshot.deadline).toBe("string");
   expect(council.snapshot.contract.content).toEqual(buildContractContent(projectId));
   expect(council.snapshot.participants).toEqual([
      { participantId: "head:engineering", headRoleId: "head:engineering", departmentId: "engineering", sessionRef: "opaque:engineering" },
      { participantId: "head:product", headRoleId: "head:product", departmentId: "product", sessionRef: "opaque:product" },
    ]);
   const stored = await pool.query<{ snapshot_payload: Record<string, unknown> }>("SELECT snapshot_payload FROM head_councils WHERE council_id = $1", [council.councilId]);
   expect(stored.rows[0]!.snapshot_payload).toEqual(council.snapshot);
   const restarted = new Pool({ connectionString: databaseUrl });
   const reloaded = await readHeadCouncil(restarted, council.councilId);
   await restarted.end();
   expect(reloaded.snapshotHash).toBe(council.snapshotHash);
   expect(reloaded.snapshot).toEqual(council.snapshot);

   await submitIndependentBrief(pool, council.councilId, "product", brief, proof, headContext("product"));
   await submitIndependentBrief(pool, council.councilId, "product", brief, proof, headContext("product"));
   const changed = { ...brief, interpretation: "changed" };
   await expect(submitIndependentBrief(pool, council.councilId, "product", changed, proof, headContext("product"))).rejects.toBeInstanceOf(CouncilBriefIdempotencyError);
   await expect(readRevealedCouncilBriefs(pool, council.councilId)).rejects.toBeInstanceOf(CouncilBriefsSealedError);
   await expect(revealCouncilBriefs(pool, council.councilId, proof, context("secretary-reveal"))).rejects.toBeInstanceOf(CouncilProtocolError);
   await expect(submitIndependentBrief(pool, council.councilId, "design", brief, proof, context("outsider"))).rejects.toBeInstanceOf(CouncilProtocolError);
   await submitIndependentBrief(pool, council.councilId, "engineering", brief, proof, headContext("engineering"));
   await revealCouncilBriefs(pool, council.councilId, proof, context("secretary-reveal"));
   expect(await readRevealedCouncilBriefs(pool, council.councilId)).toHaveLength(2);

   const events = await listCouncilProtocolEvents(pool, council.councilId);
   expect(events.map((event) => event.eventType)).toEqual(["council_created", "brief_submitted", "brief_submitted", "briefs_revealed"]);
   expect(events.every((event) => event.snapshotHash === council.snapshotHash && event.actorId !== "" && event.sessionRef !== "" && event.commandOrIdempotencyId !== "")).toBe(true);
   expect(events[0]!.evidenceLineage).toMatchObject({ snapshotHash: council.snapshotHash, evidence });
   await expect(pool.query("UPDATE council_protocol_events SET actor_id = 'tampered' WHERE event_id = $1", [events[0]!.eventId])).rejects.toThrow(/append-only/);
   await expect(pool.query("DELETE FROM council_protocol_events WHERE event_id = $1", [events[0]!.eventId])).rejects.toThrow(/append-only/);
 });

 it("rejects a Council whose contract content hash is not canonical", async () => {
   const goalId = randomUUID(), contractId = randomUUID(), projectId = randomUUID();
   const contractContent = buildContractContent(projectId);
   await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
   await pool.query("INSERT INTO task_contracts (contract_id, schema_version, version, content, content_hash, launch_state) VALUES ($1, 1, 1, $2::jsonb, $3, 'launched')", [contractId, JSON.stringify(contractContent), "a".repeat(64)]);
   await pool.query("INSERT INTO goal_head_participations (goal_id, department_id, head_role_id, contract_id, status, active_session_ref) VALUES ($1, 'product', 'head:product', $2, 'active', 'opaque:product')", [goalId, contractId]);
   const proof = await acquireGoalLease(pool, { goalId, ownerId: "test", leaseDurationMs: 60_000 });
   await expect(createHeadCouncil(pool, { goalId, contractId, briefDeadline: new Date(Date.now() + 60_000), evidence }, proof, context("secretary"))).rejects.toThrow(/content hash mismatch/i);
   expect((await pool.query("SELECT count(*)::int AS count FROM head_councils WHERE goal_id = $1", [goalId])).rows[0]!.count).toBe(0);
 });

 it("validates contract identity and rejects late briefs before absence settlement", async () => {
   const setupResult = await setup(["product", "engineering"], new Date(Date.now() + 500));
   const { council, proof, goalId, contractId } = setupResult;
   const invalid = await pool.query("UPDATE task_contracts SET content_hash = $2 WHERE contract_id = $1", [contractId, "a".repeat(64)]);
   expect(invalid.rowCount).toBe(1);
   await expect(readHeadCouncil(pool, council.councilId)).resolves.toBeDefined();
   // The snapshot already captured the valid contract identity; later contract mutation does not change it.
   await submitIndependentBrief(pool, council.councilId, "product", brief, proof, headContext("product"));
   await pool.query("SELECT pg_sleep(0.7)");
   await expect(submitIndependentBrief(pool, council.councilId, "engineering", brief, proof, headContext("engineering"))).rejects.toBeInstanceOf(CouncilProtocolError);
   await expect(markMissingCouncilParticipantsAbsent(pool, council.councilId, {}, proof, context("secretary-absence"))).rejects.toBeInstanceOf(CouncilProtocolError);
   await markMissingCouncilParticipantsAbsent(pool, council.councilId, { engineering: "unavailable" }, proof, context("secretary-absence"));
   await revealCouncilBriefs(pool, council.councilId, proof, context("secretary-reveal"));
   expect(await readRevealedCouncilBriefs(pool, council.councilId)).toHaveLength(1);
   expect((await listCouncilProtocolEvents(pool, council.councilId)).map((event) => event.eventType)).toContain("participant_absent");
   expect(goalId).toBe(council.goalId);
 });

 it("requires a complete present-participant round and counts only novel evidence/arguments", async () => {
   const { council, proof } = await setup();
   await submitIndependentBrief(pool, council.councilId, "product", brief, proof, headContext("product"));
   await submitIndependentBrief(pool, council.councilId, "engineering", brief, proof, headContext("engineering"));
   await revealCouncilBriefs(pool, council.councilId, proof, context("reveal"));
   const repeated = { summary: "repeat", newEvidence: [evidence.references[0]], distinctArguments: ["argument-1"] };
   await expect(recordCouncilRound(pool, council.councilId, [], proof, context("round-empty"))).rejects.toBeInstanceOf(CouncilProtocolError);
   await expect(recordCouncilRound(pool, council.councilId, [{ departmentId: "product", contribution: repeated, submittedBy: headContext("product") }], proof, context("round-partial"))).rejects.toBeInstanceOf(CouncilProtocolError);
   await expect(recordCouncilRound(pool, council.councilId, [{ departmentId: "product", contribution: { summary: "unknown", newEvidence: ["unknown-evidence"], distinctArguments: [] }, submittedBy: headContext("product") }, { departmentId: "engineering", contribution: { summary: "ok", newEvidence: [], distinctArguments: [] }, submittedBy: headContext("engineering") }], proof, context("round-unknown"))).rejects.toBeInstanceOf(CouncilProtocolError);

   const first = await recordCouncilRound(pool, council.councilId, [
     { departmentId: "product", contribution: { summary: "new product", newEvidence: [evidence.references[0]], distinctArguments: ["argument-1"] }, submittedBy: headContext("product") },
     { departmentId: "engineering", contribution: { summary: "new engineering", newEvidence: [evidence.references[1]], distinctArguments: ["argument-2"] }, submittedBy: headContext("engineering") },
   ], proof, context("round-1"));
   expect(first.state).toBe("revealed");
   const second = await recordCouncilRound(pool, council.councilId, [
     { departmentId: "product", contribution: repeated, submittedBy: headContext("product") },
     { departmentId: "engineering", contribution: { summary: "repeat", newEvidence: [evidence.references[1]], distinctArguments: ["argument-2"] }, submittedBy: headContext("engineering") },
   ], proof, context("round-2"));
   expect(second.state).toBe("revealed");
   expect(second.noNewEvidenceStreak).toBe(1);
   const third = await recordCouncilRound(pool, council.councilId, [
     { departmentId: "product", contribution: repeated, submittedBy: headContext("product") },
     { departmentId: "engineering", contribution: { summary: "repeat", newEvidence: [evidence.references[1]], distinctArguments: ["argument-2"] }, submittedBy: headContext("engineering") },
   ], proof, context("round-3"));
   expect(third.state).toBe("stopped_no_new_evidence");
   expect((await listCouncilProtocolEvents(pool, council.councilId)).map((event) => event.eventType)).toContain("council_stopped");
 });

 it("records escalation as an explicit non-executable outcome", async () => {
   const { council, proof } = await setup(["product"]);
   await submitIndependentBrief(pool, council.councilId, "product", brief, proof, headContext("product"));
   await revealCouncilBriefs(pool, council.councilId, proof, context("reveal"));
   const packet = { executionDisposition: "non_executable" as const, outcome: "escalated" as const, selectedDirection: "Escalate to Phase 3 Council", rejectedAlternatives: [], departmentOwnership: [], workerPlan: [], completionCriteria: ["review"], failureCriteria: ["conflict remains"], dissent: ["product objects"], uncertainty: ["scope"], criticalActions: [], unresolvedConflicts: ["material scope conflict"], evidenceReferences: [evidence.references[0]] };
   assertValidDecisionPacket(packet);
   const result = await recordCouncilDecisionPacket(pool, council.councilId, packet, proof, context("secretary-decision"));
   expect(result.state).toBe("escalated");
   expect(result.decisionPacket?.executionDisposition).toBe("non_executable");
   expect(result.decisionPacket?.workerPlan).toEqual([]);
   expect(result.decisionPacket?.criticalActions).toEqual([]);
   expect((await listCouncilProtocolEvents(pool, council.councilId)).map((event) => event.eventType)).toContain("decision_escalated");
 });

 it("protects snapshot identity from direct and coordinated tampering", async () => {
   const { council } = await setup(["product"]);
   await expect(pool.query("UPDATE head_councils SET brief_deadline = clock_timestamp() WHERE council_id = $1", [council.councilId])).rejects.toThrow(/immutable/i);

   const { snapshotHash: _snapshotHash, ...snapshotInput } = council.snapshot;
   const tampered = freezeSealedSubmissionSnapshot({ ...snapshotInput, deadline: new Date(Date.now() + 120_000) });
   expect(sealedSubmissionSnapshotHash(tampered)).toBe(tampered.snapshotHash);
   await pool.query("ALTER TABLE head_councils DISABLE TRIGGER head_councils_snapshot_identity_immutable");
   try {
     await pool.query("UPDATE head_councils SET brief_deadline = $2, snapshot_hash = $3, snapshot_payload = $4::jsonb WHERE council_id = $1", [council.councilId, tampered.deadline, tampered.snapshotHash, JSON.stringify(tampered)]);
   } finally {
     await pool.query("ALTER TABLE head_councils ENABLE TRIGGER head_councils_snapshot_identity_immutable");
   }
   await expect(readHeadCouncil(pool, council.councilId)).rejects.toThrow(/creation|snapshot/i);
 });

  it("accepts only a valid launched Task Contract", async () => {
    const goalId = randomUUID();
    const contractId = randomUUID();
    const projectId = randomUUID();
    const contractContent = buildContractContent(projectId);
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
    await pool.query("INSERT INTO task_contracts (contract_id, schema_version, version, content, content_hash, launch_state) VALUES ($1, 1, 1, $2::jsonb, $3, 'awaiting_confirmation')", [contractId, JSON.stringify(contractContent), taskContractContentHash(contractContent)]);
    // 0014 rejects active participation rows bound to an unlaunched contract;
    // the Council creation path rejects the contract before it needs a match.
    await pool.query("INSERT INTO goal_head_participations (goal_id, department_id, head_role_id, contract_id, status, active_session_ref) VALUES ($1, 'product', 'head:product', NULL, 'active', 'opaque:product')", [goalId]);
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "test", leaseDurationMs: 60_000 });

    await expect(createHeadCouncil(pool, { goalId, contractId, briefDeadline: new Date(Date.now() + 60_000), evidence }, proof, context("secretary"))).rejects.toThrow(/launched/i);
    expect((await pool.query("SELECT count(*)::int AS count FROM head_councils WHERE goal_id = $1", [goalId])).rows[0]!.count).toBe(0);
  });

  it("rejects malformed Task Contract substance before Council creation", async () => {
    const goalId = randomUUID();
    const contractId = randomUUID();
    const projectId = randomUUID();
    const malformed = {};
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
    await pool.query("INSERT INTO task_contracts (contract_id, schema_version, version, content, content_hash, launch_state) VALUES ($1, 1, 1, $2::jsonb, $3, 'launched')", [contractId, JSON.stringify(malformed), taskContractContentHash(malformed as TaskContractSubstance)]);
    await pool.query("INSERT INTO goal_head_participations (goal_id, department_id, head_role_id, contract_id, status, active_session_ref) VALUES ($1, 'product', 'head:product', $2, 'active', 'opaque:product')", [goalId, contractId]);
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "test", leaseDurationMs: 60_000 });

    await expect(createHeadCouncil(pool, { goalId, contractId, briefDeadline: new Date(Date.now() + 60_000), evidence }, proof, context("secretary"))).rejects.toThrow(/Task Contract/i);
    expect((await pool.query("SELECT count(*)::int AS count FROM head_councils WHERE goal_id = $1", [goalId])).rows[0]!.count).toBe(0);
  });

  it("binds brief acceptance and audit to the captured authorized Head actor and session", async () => {
    const { council, proof } = await setup(["product"]);
    await expect(submitIndependentBrief(pool, council.councilId, "product", brief, proof, { actorId: "head:engineering", sessionRef: "opaque:product", commandId: randomUUID() })).rejects.toBeInstanceOf(CouncilProtocolError);
    await expect(submitIndependentBrief(pool, council.councilId, "product", brief, proof, { actorId: "head:product", sessionRef: "opaque:product-restarted", commandId: randomUUID() })).rejects.toBeInstanceOf(CouncilProtocolError);

    await pool.query("UPDATE goal_head_participations SET active_session_ref = 'opaque:product-restarted' WHERE goal_id = $1 AND department_id = 'product'", [council.goalId]);
    await expect(submitIndependentBrief(pool, council.councilId, "product", brief, proof, headContext("product"))).rejects.toBeInstanceOf(CouncilProtocolError);
    expect((await pool.query("SELECT count(*)::int AS count FROM independent_briefs WHERE council_id = $1", [council.councilId])).rows[0]!.count).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS count FROM council_protocol_events WHERE council_id = $1 AND event_type = 'brief_submitted'", [council.councilId])).rows[0]!.count).toBe(0);
  });

  it("uses current database time after the Council row lock for deadline decisions", async () => {
    const { council, proof } = await setup(["product"], new Date(Date.now() + 250));
    const blocker = await pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT council_id FROM head_councils WHERE council_id = $1 FOR UPDATE", [council.councilId]);
      const pending = submitIndependentBrief(pool, council.councilId, "product", brief, proof, headContext("product"));
      await new Promise((resolve) => setTimeout(resolve, 600));
      await blocker.query("COMMIT");
      await expect(pending).rejects.toThrow(/deadline/i);
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
    }
  });

  it("requires frozen evidence references to be durable goal-scoped records", async () => {
    const invented = { references: [randomUUID()] };
    await expect(setup(["product"], new Date(Date.now() + 60_000), invented)).rejects.toThrow(/evidence/i);
  });

  it("requires every round evidence reference to resolve to a durable record", async () => {
    const { council, proof } = await setup(["product"]);
    await submitIndependentBrief(pool, council.councilId, "product", brief, proof, headContext("product"));
    await revealCouncilBriefs(pool, council.councilId, proof, context("reveal"));
    await expect(recordCouncilRound(pool, council.councilId, [{ departmentId: "product", contribution: { summary: "invented", newEvidence: [randomUUID()], distinctArguments: ["argument"] }, submittedBy: headContext("product") }], proof, context("round"))).rejects.toBeInstanceOf(CouncilProtocolError);
    expect((await pool.query("SELECT count(*)::int AS count FROM council_rounds WHERE council_id = $1", [council.councilId])).rows[0]!.count).toBe(0);
  });

  it("enforces bidirectional Council state and decision outcome consistency in the database", async () => {
    const { council } = await setup(["product"]);
    const escalated = { executionDisposition: "non_executable", outcome: "escalated", selectedDirection: "escalate", rejectedAlternatives: [], departmentOwnership: [], workerPlan: [], completionCriteria: ["review"], failureCriteria: ["conflict"], dissent: ["dissent"], uncertainty: ["uncertainty"], criticalActions: [], unresolvedConflicts: ["conflict"], evidenceReferences: [] };
    const decided = { executionDisposition: "executable", outcome: "decided", selectedDirection: "proceed", rejectedAlternatives: [], departmentOwnership: [], workerPlan: [], completionCriteria: ["done"], failureCriteria: ["fail"], dissent: [], uncertainty: [], criticalActions: [], unresolvedConflicts: [], evidenceReferences: [] };
    await expect(pool.query("UPDATE head_councils SET state = 'resolved', decision_packet = $2::jsonb, closed_at = clock_timestamp() WHERE council_id = $1", [council.councilId, JSON.stringify(escalated)])).rejects.toThrow();
    await expect(pool.query("UPDATE head_councils SET state = 'escalated', decision_packet = $2::jsonb, closed_at = clock_timestamp() WHERE council_id = $1", [council.councilId, JSON.stringify(decided)])).rejects.toThrow();
  });

  it("reuses an existing Council for the same Goal and Task Contract instead of creating a duplicate", async () => {
    const { goalId, contractId, proof, council } = await setup(["product"]);
    const replay = await createHeadCouncil(pool, { goalId, contractId, briefDeadline: new Date(council.briefDeadline), evidence }, proof, context("secretary"));
    expect(replay.councilId).toBe(council.councilId);
    expect((await pool.query("SELECT count(*)::int AS count FROM head_councils WHERE goal_id = $1 AND contract_id = $2", [goalId, contractId])).rows[0]!.count).toBe(1);
  });

  it("denies Council writes once the Goal is paused", async () => {
    const { council, proof, projectId, goalId } = await setup(["product"]);
    await pool.query("INSERT INTO goal_controls (project_id, goal_id, pause_requested_at, paused_at) VALUES ($1, $2, clock_timestamp(), clock_timestamp()) ON CONFLICT (project_id, goal_id) DO UPDATE SET pause_requested_at = clock_timestamp(), paused_at = clock_timestamp()", [projectId, goalId]);
    await expect(submitIndependentBrief(pool, council.councilId, "product", brief, proof, headContext("product"))).rejects.toBeInstanceOf(CouncilProtocolError);
  });

  it("rejects an executable decision packet that assigns an uncaptured Department", async () => {
    const { council, proof } = await setup(["product"]);
    await submitIndependentBrief(pool, council.councilId, "product", brief, proof, headContext("product"));
    await revealCouncilBriefs(pool, council.councilId, proof, context("reveal"));
    const bogus = { executionDisposition: "executable" as const, outcome: "decided" as const, selectedDirection: "proceed", rejectedAlternatives: [], departmentOwnership: [{ departmentId: "not-a-participant", responsibility: "own it" }], workerPlan: [], completionCriteria: ["done"], failureCriteria: ["fail"], dissent: [], uncertainty: [], criticalActions: [], unresolvedConflicts: [], evidenceReferences: [] };
    await expect(recordCouncilDecisionPacket(pool, council.councilId, bogus, proof, context("decision"))).rejects.toBeInstanceOf(CouncilProtocolError);
  });

  it("makes an identical decision packet retry idempotent and a differing retry a conflict", async () => {
    const { council, proof } = await setup(["product"]);
    await submitIndependentBrief(pool, council.councilId, "product", brief, proof, headContext("product"));
    await revealCouncilBriefs(pool, council.councilId, proof, context("reveal"));
    const decided = { executionDisposition: "executable" as const, outcome: "decided" as const, selectedDirection: "proceed", rejectedAlternatives: [], departmentOwnership: [], workerPlan: [], completionCriteria: ["done"], failureCriteria: ["fail"], dissent: [], uncertainty: [], criticalActions: [], unresolvedConflicts: [], evidenceReferences: [] };
    const first = await recordCouncilDecisionPacket(pool, council.councilId, decided, proof, context("decision"));
    const replay = await recordCouncilDecisionPacket(pool, council.councilId, decided, proof, context("decision-replay"));
    expect(replay.decisionPacket).toEqual(first.decisionPacket);
    const different = { ...decided, selectedDirection: "proceed differently" };
    await expect(recordCouncilDecisionPacket(pool, council.councilId, different, proof, context("decision-conflict"))).rejects.toBeInstanceOf(CouncilProtocolError);
  });

  it("stops after two contextless rounds with identical content instead of treating the second as a replay", async () => {
    const { council, proof } = await setup(["product"]);
    await submitIndependentBrief(pool, council.councilId, "product", brief, proof, headContext("product"));
    await revealCouncilBriefs(pool, council.councilId, proof, context("reveal"));
    const repeated = { summary: "no new evidence", newEvidence: [], distinctArguments: [] };
    const first = await recordCouncilRound(pool, council.councilId, [{ departmentId: "product", contribution: repeated, submittedBy: headContext("product") }], proof);
    expect(first.noNewEvidenceStreak).toBe(1);
    expect(first.state).toBe("revealed");
    const second = await recordCouncilRound(pool, council.councilId, [{ departmentId: "product", contribution: repeated, submittedBy: headContext("product") }], proof);
    expect(second.noNewEvidenceStreak).toBe(2);
    expect(second.state).toBe("stopped_no_new_evidence");
    expect((await pool.query("SELECT count(*)::int AS count FROM council_rounds WHERE council_id = $1", [council.councilId])).rows[0]!.count).toBe(2);
  });

  it("makes a round retry idempotent only when the caller supplies an explicit identity, and rejects a differing retry", async () => {
    const { council, proof } = await setup(["product"]);
    await submitIndependentBrief(pool, council.councilId, "product", brief, proof, headContext("product"));
    await revealCouncilBriefs(pool, council.councilId, proof, context("reveal"));
    const contribution = { summary: "first pass", newEvidence: [evidence.references[0]], distinctArguments: ["argument-1"] };
    const roundContext = { actorId: "secretary", sessionRef: "session:secretary", idempotencyKey: "round-retry-1" };
    const first = await recordCouncilRound(pool, council.councilId, [{ departmentId: "product", contribution, submittedBy: headContext("product") }], proof, roundContext);
    const replay = await recordCouncilRound(pool, council.councilId, [{ departmentId: "product", contribution, submittedBy: headContext("product") }], proof, roundContext);
    expect(replay).toEqual(first);
    expect((await pool.query("SELECT count(*)::int AS count FROM council_rounds WHERE council_id = $1", [council.councilId])).rows[0]!.count).toBe(1);
    const different = { summary: "different pass", newEvidence: [], distinctArguments: ["different"] };
    await expect(recordCouncilRound(pool, council.councilId, [{ departmentId: "product", contribution: different, submittedBy: headContext("product") }], proof, roundContext)).rejects.toBeInstanceOf(CouncilProtocolError);
  });

  it("redacts sealed brief content from the protocol event stream before reveal", async () => {
    const { council, proof } = await setup(["product", "engineering"]);
    await submitIndependentBrief(pool, council.councilId, "product", brief, proof, headContext("product"));
    const events = await listCouncilProtocolEvents(pool, council.councilId);
    const briefEvent = events.find((event) => event.eventType === "brief_submitted");
    expect(briefEvent).toBeDefined();
    expect(JSON.stringify(briefEvent!.payload)).not.toContain("safe outcome");
    expect(briefEvent!.payload.brief).toBe("[redacted-until-reveal]");
  });
 });
