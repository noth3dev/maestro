import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

const args = parseArgs({ options: { port: { type: "string" }, state: { type: "string" }, "provider-url": { type: "string" } } }).values;
const port = Number(args.port);
const statePath = args.state;
const providerUrl = args["provider-url"];
if (!port || !statePath || !providerUrl) throw new Error("control plane requires --port, --state, and --provider-url");
let state;
try { state = JSON.parse(await readFile(statePath, "utf8")); } catch (error) { if (error?.code !== "ENOENT") throw new Error(`fake Control Plane state is unreadable: ${error.message}`); state = { provider: "fake", lastStep: 0, generation: 1, goalId: randomUUID(), bundleId: randomUUID(), events: [], certifications: [], approvals: [], effects: [], providerCalls: 0 }; }
const save = () => writeFile(statePath, JSON.stringify(state, null, 2) + "\n");
const provider = async (operation, target, extra = {}) => {
  const response = await fetch(`${providerUrl}/execute`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation, target, ...extra }) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "fake provider failed");
  state.providerCalls = value.callCount;
  return value;
};
const stateFromProvider = async () => (await (await fetch(`${providerUrl}/state`)).json());
const body = async (request) => { let text = ""; for await (const chunk of request) text += chunk; return text === "" ? {} : JSON.parse(text); };
const json = (response, status, value) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(value)); };
const event = (name, details = {}) => { const value = { step: state.lastStep + 1, name, ...details }; state.events.push(value); return value; };
const reportPath = `${statePath}.report.json`;
const buildReport = () => ({ reportId: state.reportId ?? (state.reportId = randomUUID()), goalId: state.goalId, success: state.certifications.some((item) => item.verdict === "passed"), blockers: [], ceoRequest: "Repair the discount calculation", whatChanged: "Disposable target repaired", userVisibleBehaviorPassed: state.certifications.some((item) => item.verdict === "passed"), participatingDepartments: ["engineering"], keyDecisions: state.events.map((item) => item.name), dissent: [], independentValidation: state.certifications.map((item) => item.verdict), costCents: 0, budgetCents: 0, incidents: [], knownLimitations: ["Fake provider; live run is user-owned"], criticalActionAwaitingApproval: state.approvals.some((item) => item.status === "pending"), evidenceBundleId: state.bundleId });
const evidence = async () => {
  const providerState = await stateFromProvider();
  if (!providerState.calls?.length || !providerState.remoteAttempts?.length) throw new Error("durable provider evidence is missing");
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const content = { goalId: state.goalId, events: state.events, approvals: state.approvals, effects: state.effects, certifications: state.certifications, provider: providerState };
  const hash = createHash("sha256").update(JSON.stringify(content)).digest("hex");
  return { bundle: { bundleId: state.bundleId, goalId: state.goalId, content, hash }, certifications: { certifications: state.certifications }, report };
};
const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") return json(response, 200, { ok: true, pid: process.pid, generation: state.generation });
    if (request.method === "GET" && request.url === "/state") return json(response, 200, state);
    if (request.method === "GET" && request.url === "/evidence") return json(response, 200, await evidence());
    if (request.method !== "POST" || request.url !== "/command") return json(response, 404, { error: "not_found" });
    const input = await body(request);
    const step = Number(input.step);
    if (step !== state.lastStep + 1) throw new Error(`step ${step} is out of order; expected ${state.lastStep + 1}`);
    const target = input.target;
    let observation;
    if (step === 1) observation = event("ceo_request", { goalId: state.goalId });
    else if (step === 2) observation = event("contract_intake", { target });
    else if (step === 3) observation = event("launch_confirmed", { exactHash: true });
    else if (step === 4) observation = event("necessary_heads", { activeHeads: ["engineering"] });
    else if (step === 5) observation = event("department_plan", { departments: ["engineering"] });
    else if (step === 6) { const result = await provider("test", target); if (result.result.exitCode === 0) throw new Error("seeded defect unexpectedly passed"); observation = event("native_execution", { defectCaught: true, providerCalls: state.providerCalls }); }
    else if (step === 7) { const providerState = await stateFromProvider(); observation = event("metronome_observation", { approvals: state.approvals.length, effects: state.effects.length, providerCalls: providerState.calls.length }); }
    else if (step === 8) { await provider("inject", target); const result = await provider("test", target); await provider("clear", target); if (result.result.exitCode === 0) throw new Error("unsupported assertion unexpectedly passed"); const providerState = await stateFromProvider(); observation = event("unsupported_assertion", { challenged: true, modelIdentities: providerState.modelIdentities }); }
    else if (step === 9) { const result = await provider("test", target); if (result.result.exitCode === 0) throw new Error("seeded defect unexpectedly passed Quality"); state.certifications.push({ verdict: "failed", revision: null }); observation = event("quality_failed", { verdict: "failed" }); }
    else if (step === 10) { event("repair_requested_through_maestro", { channel: "conversation", target }); await provider("repair", target); const result = await provider("test", target); if (result.result.exitCode !== 0) throw new Error("repair did not pass"); const revision = (await provider("revision", target)).result.revision; state.effects.push({ id: "repair:1", revision }); state.certifications.push({ verdict: "passed", revision }); observation = event("quality_certified", { verdict: "passed", integratedRevision: revision }); }
    else if (step === 11) { const trigger = JSON.parse(await readFile(`${target}/fixtures/restart-trigger.json`, "utf8")); if (trigger.status !== "checkpoint" || !Array.isArray(trigger.effectIds)) throw new Error("restart checkpoint is invalid"); const ids = state.effects.map((item) => item.id); const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index); if (duplicates.length > 0) throw new Error(`restart reconciliation rejected duplicate effects: ${duplicates.join(",")}`); state.generation += 1; observation = event("restart_reconciled", { generation: state.generation, duplicateWrites: 0, effectCount: state.effects.length, checkpointEffects: trigger.effectIds }); }
    else if (step === 12) { const result = await provider("remote", target); state.approvals.push({ action: "git.remote.push", status: "pending" }); observation = event("ambiguous_action", { escalated: true, remotePush: result.result.blocked ? "blocked" : "unknown", networkInvoked: result.result.networkInvoked }); }
    else if (step === 13) { const modeResults = []; for (const mode of ["retain_intermediate_approvals", "skip_intermediate_approvals"]) { await provider("mode", target, { mode }); const result = await provider("remote", target); modeResults.push({ mode, status: result.result.blocked ? "blocked" : "unknown", networkInvoked: result.result.networkInvoked }); } observation = event("forbidden_effect", { modeResults }); }
    else if (step === 14) { const evidenceEvent = event("evidence_dump", { readOnly: true, providerCalls: state.providerCalls }); await writeFile(reportPath, JSON.stringify(buildReport(), null, 2) + "\n"); const result = await evidence(); evidenceEvent.bundleReportMatch = result.bundle.bundleId === result.report.evidenceBundleId; state.lastEvidence = result; observation = evidenceEvent; }
    else throw new Error("step must be in range 1..14");
    state.lastStep = step;
    await save();
    return json(response, 200, { observation, state, ...(step === 14 ? await evidence() : {}) });
  } catch (error) { return json(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
});
server.listen(port, "127.0.0.1", () => console.log(`READY ${port}`));
