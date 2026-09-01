import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertValidDecisionPacket, taskContractContentHash, type IndependentBrief, type TaskContractSubstance } from "@maestro/domain";
import { bootstrapPermanentOrganization } from "./organization.js";
import { acquireGoalLease } from "./commands.js";
import { CouncilBriefIdempotencyError, CouncilBriefsSealedError, CouncilProtocolError, createHeadCouncil, listCouncilProtocolEvents, markMissingCouncilParticipantsAbsent, readHeadCouncil, readRevealedCouncilBriefs, recordCouncilDecisionPacket, recordCouncilRound, revealCouncilBriefs, submitIndependentBrief } from "./council.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const migrations = ["0001_phase1_core.sql", "0002_goal_leases.sql", "0003_local_operator_auth.sql", "0004_local_operator_credential_security.sql", "0005_authority_records.sql", "0006_evidence.sql", "0007_goal_control.sql", "0008_goal_pause_stop.sql", "0009_reconciliation_leader_lease.sql", "0010_permanent_organization.sql", "0011_task_contracts.sql", "0012_goal_head_participations.sql", "0013_council_briefs.sql", "0015_council_protocol.sql"];
const contractContent: TaskContractSubstance = {
  desiredOutcome: "deliver safely",
  userVisibleBehavior: [], successCriteria: [], liveEvidence: [], scope: [], nonGoals: [], priorities: [], acceptableTradeoffs: [], constraints: [], knownEdgeCases: [],
  project: { projectId: "project-1", repository: "repo", immutableBaseRevision: "base", dataBoundary: "local" },
  evidenceReferences: [], approvedPreviewReferences: [], expectedGroups: [], expectedDepartments: [], criticalActionExpectations: [], forbiddenEffects: [], environmentAssumptions: [], externalServiceAssumptions: [],
  budget: { ceiling: "1", reportingExpectations: [], stoppingConditions: [] },
};
const brief: IndependentBrief = { interpretation: "safe outcome", contribution: "review", nonGoals: [], assumptions: [], evidenceGaps: [], risks: [], dependencies: [], proposedValidation: [], expectedWorkers: [], expectedCost: "1", expectedTime: "1", objectionsToLikelyAlternatives: [] };
const evidence = { references: ["evidence-1", "evidence-2"] };
const context = (label: string) => ({ actorId: `actor:${label}`, sessionRef: `session:${label}`, commandId: randomUUID() });

 describeDatabase("Head Council briefs with PostgreSQL", () => {
 const pool = new Pool({ connectionString: databaseUrl });
 async function setup(departments = ["product", "engineering"], briefDeadline = new Date(Date.now() + 60_000)) {
   const goalId = randomUUID(), contractId = randomUUID(), projectId = randomUUID();
   await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
   await pool.query("INSERT INTO task_contracts (contract_id, schema_version, version, content, content_hash, launch_state) VALUES ($1, 1, 1, $2::jsonb, $3, 'launched')", [contractId, JSON.stringify(contractContent), taskContractContentHash(contractContent)]);
   for (const departmentId of departments) await pool.query("INSERT INTO goal_head_participations (goal_id, department_id, contract_id, status, active_session_ref) VALUES ($1, $2, $3, 'active', $4)", [goalId, departmentId, contractId, `opaque:${departmentId}`]);
   const proof = await acquireGoalLease(pool, { goalId, ownerId: "test", leaseDurationMs: 60_000 });
   const council = await createHeadCouncil(pool, { goalId, contractId, briefDeadline, evidence }, proof, context("secretary"));
   expect(/^[0-9a-f]{64}$/.test(council.snapshotHash)).toBe(true);
   return { goalId, contractId, projectId, proof, council };
 }
 beforeAll(async () => {
   await pool.query("DROP TABLE IF EXISTS council_protocol_events, council_round_contributions, council_rounds, independent_briefs, council_participants, head_councils, head_activation_edges, head_activation_attempts, goal_head_participations, task_contract_confirmations, task_contract_decisions, task_contracts, role_persona_axes, permanent_roles, departments, organization_groups, goal_leases, outbox, goal_events, command_receipts, goals CASCADE");
   for (const name of migrations) {
     const sql = await readFile(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), "utf8");
     await pool.query(sql);
     if (name === "0015_council_protocol.sql") await pool.query(sql);
   }
 });
 beforeEach(async () => { await pool.query("TRUNCATE council_protocol_events, head_councils, goal_head_participations, task_contracts, goal_leases, outbox, goal_events, command_receipts, goals RESTART IDENTITY CASCADE"); await bootstrapPermanentOrganization(pool); });
 afterAll(async () => { await pool.end(); });

 it("stores and reloads the complete immutable snapshot, and seals/idempotently accepts briefs", async () => {
   const { council, proof } = await setup();
   expect(typeof council.snapshot.deadline).toBe("string");
   expect(council.snapshot.contract.content).toEqual(contractContent);
   expect(council.snapshot.participants).toEqual([{ participantId: "engineering", sessionRef: "opaque:engineering" }, { participantId: "product", sessionRef: "opaque:product" }]);
   const stored = await pool.query<{ snapshot_payload: Record<string, unknown> }>("SELECT snapshot_payload FROM head_councils WHERE council_id = $1", [council.councilId]);
   expect(stored.rows[0]!.snapshot_payload).toEqual(council.snapshot);
   const restarted = new Pool({ connectionString: databaseUrl });
   const reloaded = await readHeadCouncil(restarted, council.councilId);
   await restarted.end();
   expect(reloaded.snapshotHash).toBe(council.snapshotHash);
   expect(reloaded.snapshot).toEqual(council.snapshot);

   await submitIndependentBrief(pool, council.councilId, "product", brief, proof, context("product"));
   await submitIndependentBrief(pool, council.councilId, "product", brief, proof, context("product-retry"));
   const changed = { ...brief, interpretation: "changed" };
   await expect(submitIndependentBrief(pool, council.councilId, "product", changed, proof, context("product-mismatch"))).rejects.toBeInstanceOf(CouncilBriefIdempotencyError);
   await expect(readRevealedCouncilBriefs(pool, council.councilId)).rejects.toBeInstanceOf(CouncilBriefsSealedError);
   await expect(revealCouncilBriefs(pool, council.councilId, proof, context("secretary-reveal"))).rejects.toBeInstanceOf(CouncilProtocolError);
   await expect(submitIndependentBrief(pool, council.councilId, "design", brief, proof, context("outsider"))).rejects.toBeInstanceOf(CouncilProtocolError);
   await submitIndependentBrief(pool, council.councilId, "engineering", brief, proof, context("engineering"));
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
   await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
   await pool.query("INSERT INTO task_contracts (contract_id, schema_version, version, content, content_hash, launch_state) VALUES ($1, 1, 1, $2::jsonb, $3, 'launched')", [contractId, JSON.stringify(contractContent), "a".repeat(64)]);
   await pool.query("INSERT INTO goal_head_participations (goal_id, department_id, contract_id, status, active_session_ref) VALUES ($1, 'product', $2, 'active', 'opaque:product')", [goalId, contractId]);
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
   await submitIndependentBrief(pool, council.councilId, "product", brief, proof, context("product"));
   await pool.query("SELECT pg_sleep(0.7)");
   await expect(submitIndependentBrief(pool, council.councilId, "engineering", brief, proof, context("engineering-late"))).rejects.toBeInstanceOf(CouncilProtocolError);
   await expect(markMissingCouncilParticipantsAbsent(pool, council.councilId, {}, proof, context("secretary-absence"))).rejects.toBeInstanceOf(CouncilProtocolError);
   await markMissingCouncilParticipantsAbsent(pool, council.councilId, { engineering: "unavailable" }, proof, context("secretary-absence"));
   await revealCouncilBriefs(pool, council.councilId, proof, context("secretary-reveal"));
   expect(await readRevealedCouncilBriefs(pool, council.councilId)).toHaveLength(1);
   expect((await listCouncilProtocolEvents(pool, council.councilId)).map((event) => event.eventType)).toContain("participant_absent");
   expect(goalId).toBe(council.goalId);
 });

 it("requires a complete present-participant round and counts only novel evidence/arguments", async () => {
   const { council, proof } = await setup();
   await submitIndependentBrief(pool, council.councilId, "product", brief, proof, context("product"));
   await submitIndependentBrief(pool, council.councilId, "engineering", brief, proof, context("engineering"));
   await revealCouncilBriefs(pool, council.councilId, proof, context("reveal"));
   const repeated = { summary: "repeat", newEvidence: ["evidence-1"], distinctArguments: ["argument-1"] };
   await expect(recordCouncilRound(pool, council.councilId, [], proof, context("round-empty"))).rejects.toBeInstanceOf(CouncilProtocolError);
   await expect(recordCouncilRound(pool, council.councilId, [{ departmentId: "product", contribution: repeated }], proof, context("round-partial"))).rejects.toBeInstanceOf(CouncilProtocolError);
   await expect(recordCouncilRound(pool, council.councilId, [{ departmentId: "product", contribution: { summary: "unknown", newEvidence: ["unknown-evidence"], distinctArguments: [] } }, { departmentId: "engineering", contribution: { summary: "ok", newEvidence: [], distinctArguments: [] } }], proof, context("round-unknown"))).rejects.toBeInstanceOf(CouncilProtocolError);

   const first = await recordCouncilRound(pool, council.councilId, [
     { departmentId: "product", contribution: { summary: "new product", newEvidence: ["evidence-1"], distinctArguments: ["argument-1"] } },
     { departmentId: "engineering", contribution: { summary: "new engineering", newEvidence: ["evidence-2"], distinctArguments: ["argument-2"] } },
   ], proof, context("round-1"));
   expect(first.state).toBe("revealed");
   const second = await recordCouncilRound(pool, council.councilId, [
     { departmentId: "product", contribution: repeated },
     { departmentId: "engineering", contribution: { summary: "repeat", newEvidence: ["evidence-2"], distinctArguments: ["argument-2"] } },
   ], proof, context("round-2"));
   expect(second.state).toBe("revealed");
   expect(second.noNewEvidenceStreak).toBe(1);
   const third = await recordCouncilRound(pool, council.councilId, [
     { departmentId: "product", contribution: repeated },
     { departmentId: "engineering", contribution: { summary: "repeat", newEvidence: ["evidence-2"], distinctArguments: ["argument-2"] } },
   ], proof, context("round-3"));
   expect(third.state).toBe("stopped_no_new_evidence");
   expect((await listCouncilProtocolEvents(pool, council.councilId)).map((event) => event.eventType)).toContain("council_stopped");
 });

 it("records escalation as an explicit non-executable outcome", async () => {
   const { council, proof } = await setup(["product"]);
   await submitIndependentBrief(pool, council.councilId, "product", brief, proof, context("product"));
   await revealCouncilBriefs(pool, council.councilId, proof, context("reveal"));
   const packet = { executionDisposition: "non_executable" as const, outcome: "escalated" as const, selectedDirection: "Escalate to Phase 3 Council", rejectedAlternatives: [], departmentOwnership: [], workerPlan: [], completionCriteria: ["review"], failureCriteria: ["conflict remains"], dissent: ["product objects"], uncertainty: ["scope"], criticalActions: [], unresolvedConflicts: ["material scope conflict"], evidenceReferences: ["evidence-1"] };
   assertValidDecisionPacket(packet);
   const result = await recordCouncilDecisionPacket(pool, council.councilId, packet, proof, context("secretary-decision"));
   expect(result.state).toBe("escalated");
   expect(result.decisionPacket?.executionDisposition).toBe("non_executable");
   expect(result.decisionPacket?.workerPlan).toEqual([]);
   expect(result.decisionPacket?.criticalActions).toEqual([]);
   expect((await listCouncilProtocolEvents(pool, council.councilId)).map((event) => event.eventType)).toContain("decision_escalated");
 });

 it("fails closed when the stored snapshot payload is tampered", async () => {
   const { council } = await setup(["product"]);
   await pool.query("UPDATE head_councils SET snapshot_payload = jsonb_set(snapshot_payload, '{evidence,references,0}', to_jsonb('tampered'::text)) WHERE council_id = $1", [council.councilId]);
   await expect(readHeadCouncil(pool, council.councilId)).rejects.toThrow(/snapshot hash|snapshot/i);
 });
});
