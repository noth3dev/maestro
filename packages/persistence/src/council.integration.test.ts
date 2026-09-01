import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertValidDecisionPacket, type IndependentBrief } from "@maestro/domain";
import { bootstrapPermanentOrganization } from "./organization.js";
import { acquireGoalLease } from "./commands.js";
import { CouncilBriefsSealedError, CouncilProtocolError, createHeadCouncil, markMissingCouncilParticipantsAbsent, readRevealedCouncilBriefs, recordCouncilDecisionPacket, recordCouncilRound, revealCouncilBriefs, submitIndependentBrief } from "./council.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const migrations = ["0001_phase1_core.sql", "0002_goal_leases.sql", "0003_local_operator_auth.sql", "0004_local_operator_credential_security.sql", "0005_authority_records.sql", "0006_evidence.sql", "0007_goal_control.sql", "0008_goal_pause_stop.sql", "0009_reconciliation_leader_lease.sql", "0010_permanent_organization.sql", "0011_task_contracts.sql", "0012_goal_head_participations.sql", "0013_council_briefs.sql"];
const brief: IndependentBrief = { interpretation: "safe outcome", contribution: "review", nonGoals: [], assumptions: [], evidenceGaps: [], risks: [], dependencies: [], proposedValidation: [], expectedWorkers: [], expectedCost: "1", expectedTime: "1", objectionsToLikelyAlternatives: [] };

describeDatabase("Head Council briefs with PostgreSQL", () => {
 const pool = new Pool({ connectionString: databaseUrl });
 async function setup(departments = ["product", "engineering"]) {
   const goalId = randomUUID(), contractId = randomUUID();
   await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, randomUUID()]);
   await pool.query("INSERT INTO task_contracts (contract_id, schema_version, version, content, content_hash, launch_state) VALUES ($1, 1, 1, '{}'::jsonb, $2, 'launched')", [contractId, "a".repeat(64)]);
   for (const departmentId of departments) await pool.query("INSERT INTO goal_head_participations (goal_id, department_id, contract_id, status, active_session_ref) VALUES ($1, $2, $3, 'active', $4)", [goalId, departmentId, contractId, `opaque:${departmentId}`]);
   const proof = await acquireGoalLease(pool, { goalId, ownerId: "test", leaseDurationMs: 60_000 });
   const council = await createHeadCouncil(pool, { goalId, contractId, briefDeadline: new Date(Date.now() + 60_000) }, proof);
   if (!/^[0-9a-f]{64}$/.test(council.snapshotHash)) throw new Error("createHeadCouncil must bind a frozen sealed-submission snapshot hash");
   return { goalId, contractId, proof, council };
 }
 beforeAll(async () => { await pool.query("DROP TABLE IF EXISTS council_round_contributions, council_rounds, independent_briefs, council_participants, head_councils, head_activation_edges, head_activation_attempts, goal_head_participations, task_contract_confirmations, task_contract_decisions, task_contracts, role_persona_axes, permanent_roles, departments, organization_groups, goal_leases, outbox, goal_events, command_receipts, goals CASCADE"); for (const name of migrations) await pool.query(await readFile(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), "utf8")); });
 beforeEach(async () => { await pool.query("TRUNCATE head_councils, goal_head_participations, task_contracts, goal_leases, outbox, goal_events, command_receipts, goals RESTART IDENTITY CASCADE"); await bootstrapPermanentOrganization(pool); });
 afterAll(async () => { await pool.end(); });

 it("seals briefs until every captured active participant submits, and rejects outsiders and duplicates", async () => {
   const { council, proof } = await setup();
   await submitIndependentBrief(pool, council.councilId, "product", brief, proof);
   await expect(readRevealedCouncilBriefs(pool, council.councilId)).rejects.toBeInstanceOf(CouncilBriefsSealedError);
   await expect(revealCouncilBriefs(pool, council.councilId, proof)).rejects.toBeInstanceOf(CouncilProtocolError);
   await expect(submitIndependentBrief(pool, council.councilId, "design", brief, proof)).rejects.toBeInstanceOf(CouncilProtocolError);
   await expect(submitIndependentBrief(pool, council.councilId, "product", brief, proof)).rejects.toBeInstanceOf(CouncilProtocolError);
   await submitIndependentBrief(pool, council.councilId, "engineering", brief, proof);
   await revealCouncilBriefs(pool, council.councilId, proof);
   expect(await readRevealedCouncilBriefs(pool, council.councilId)).toHaveLength(2);
 });

 it("requires deadline absence reasons for reveal and stops after two derived empty rounds", async () => {
   const { council, proof } = await setup();
   await pool.query("UPDATE head_councils SET brief_deadline = transaction_timestamp() - interval '1 second' WHERE council_id = $1", [council.councilId]);
   await submitIndependentBrief(pool, council.councilId, "product", brief, proof);
   await expect(markMissingCouncilParticipantsAbsent(pool, council.councilId, {}, proof)).rejects.toBeInstanceOf(CouncilProtocolError);
   await markMissingCouncilParticipantsAbsent(pool, council.councilId, { engineering: "unavailable" }, proof);
   await revealCouncilBriefs(pool, council.councilId, proof);
   expect((await recordCouncilRound(pool, council.councilId, [{ departmentId: "product", contribution: { summary: "repeat", newEvidence: [], distinctArguments: [] } }], proof)).state).toBe("revealed");
   expect((await recordCouncilRound(pool, council.councilId, [], proof)).state).toBe("stopped_no_new_evidence");
 });

 it("records unresolved qualifying conflict as escalation rather than a resolved vote", async () => {
   const { council, proof } = await setup(["product"]); await submitIndependentBrief(pool, council.councilId, "product", brief, proof); await revealCouncilBriefs(pool, council.councilId, proof);
   const packet = { outcome: "escalated" as const, selectedDirection: "Escalate to Phase 3 Council", rejectedAlternatives: [], departmentOwnership: [], workerPlan: [], completionCriteria: ["review"], failureCriteria: ["conflict remains"], dissent: ["product objects"], uncertainty: ["scope"], criticalActions: [], unresolvedConflicts: ["material scope conflict"], evidenceReferences: [] };
   assertValidDecisionPacket(packet);
   expect((await recordCouncilDecisionPacket(pool, council.councilId, packet, proof)).state).toBe("escalated");
 });
});
