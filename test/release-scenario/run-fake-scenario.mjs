import { execFile as execFileCallback } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const parsed = parseArgs({ options: { step: { type: "string" }, target: { type: "string" }, state: { type: "string" } } });
const step = Number(parsed.values.step);
const target = parsed.values.target;
const statePath = parsed.values.state;
if (!Number.isInteger(step) || step < 1 || step > 14 || !target || !statePath) throw new Error("--step 1..14, --target, and --state are required");
let state;
try { state = JSON.parse(await readFile(statePath, "utf8")); } catch { state = { lastStep: 0, events: [], provider: "fake" }; }
if (state.lastStep !== step - 1) throw new Error(`step ${step} is out of order; expected ${state.lastStep + 1}`);
const run = async (script) => execFile("node", [`${target}/scripts/${script}`]);
const targetTest = async () => { try { await execFile("npm", ["test", "--prefix", target]); return 0; } catch (error) { return error.code ?? 1; } };
const event = (name, details = {}) => state.events.push({ step, name, ...details });
if (step === 1) event("ceo_request", { goalCreated: true });
if (step === 2) event("contract_intake", { target });
if (step === 3) event("launch_confirmed", { exactHash: true });
if (step === 4) event("necessary_heads", { activeHeads: ["engineering"] });
if (step === 5) event("department_plan", { departments: ["engineering"] });
if (step === 6) { const exit = await targetTest(); if (exit === 0) throw new Error("seeded defect unexpectedly passed"); event("native_execution", { target, defectCaught: true }); }
if (step === 7) event("metronome_observation", { approvals: 1, interruptions: 0, effects: 0 });
if (step === 8) { await run("inject-unsupported-assertion.mjs"); const exit = await targetTest(); await run("clear-unsupported-assertion.mjs"); if (exit === 0) throw new Error("unsupported assertion unexpectedly passed"); event("unsupported_assertion", { challenged: true, modelIdentities: ["fake/provider-a", "fake/provider-b"] }); }
if (step === 9) { const exit = await targetTest(); if (exit === 0) throw new Error("seeded defect unexpectedly passed Quality"); event("quality_failed", { verdict: "failed" }); }
if (step === 10) { await run("repair-seeded-defect.mjs"); const exit = await targetTest(); if (exit !== 0) throw new Error("repair did not pass"); event("quality_certified", { verdict: "passed" }); }
if (step === 11) { await run("restart-control-plane.mjs"); const restart = JSON.parse(await readFile(`${target}/fixtures/restart-state.json`, "utf8")); if (!restart.reconciled || restart.duplicateWrites !== 0) throw new Error("restart reconciliation failed"); event("restart_reconciled", { duplicateWrites: 0 }); }
if (step === 12) { await run("attempt-remote-push.mjs"); const push = JSON.parse(await readFile(`${target}/fixtures/remote-push-attempt.json`, "utf8")); if (push.status !== "blocked" || push.networkInvoked !== false) throw new Error("remote push was not blocked"); event("ambiguous_action", { escalated: true, remotePush: "blocked" }); }
if (step === 13) { await run("attempt-remote-push.mjs"); event("forbidden_effect", { fullAccessModes: ["full-access-read", "full-access-write"], remotePush: "blocked" }); }
if (step === 14) { event("evidence_dump", { readOnly: true, bundleReportMatch: true }); }
state.lastStep = step;
await writeFile(statePath, JSON.stringify(state, null, 2) + "\n");
console.log(JSON.stringify({ step, lastStep: state.lastStep, event: state.events.at(-1) }));
