import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { assertReleaseScenarioTarget } from "./fixture.mjs";

const values = parseArgs({ options: { step: { type: "string" }, target: { type: "string" }, state: { type: "string" } } }).values;
const step = Number(values.step);
const target = values.target;
const statePath = values.state;
if (!Number.isInteger(step) || step < 1 || step > 14 || !target || !statePath) throw new Error("--step 1..14, --target, and --state are required");
const worktreeRoot = process.env.MAESTRO_WORKTREE_ROOT;
const realTarget = await assertReleaseScenarioTarget(target, worktreeRoot);
const getPort = async () => await new Promise((resolve, reject) => { const probe = createServer(); probe.once("error", reject); probe.listen(0, "127.0.0.1", () => { const address = probe.address(); probe.close(() => resolve(address.port)); }); });
const waitReady = async (url) => { const deadline = Date.now() + 5000; while (Date.now() < deadline) { try { const response = await fetch(`${url}/health`); if (response.ok) return; } catch { await Promise.resolve(); } await new Promise((resolve) => setTimeout(resolve, 25)); } throw new Error(`service did not become ready: ${url}`); };
const start = async (script, args) => { const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, MAESTRO_WORKTREE_ROOT: worktreeRoot }, stdio: ["ignore", "pipe", "pipe"] }); let stderr = ""; child.stderr.on("data", (chunk) => { stderr += String(chunk); }); return { child, stderr: () => stderr }; };
const stop = async ({ child }) => { if (child.exitCode === null) child.kill("SIGTERM"); await new Promise((resolve) => child.once("close", resolve)); };
const post = async (url, value) => { const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`); return result; };
const providerStatePath = `${statePath}.provider.json`;
const providerPort = await getPort();
const provider = await start(new URL("./fake-provider-process.mjs", import.meta.url).pathname, ["--port", String(providerPort), "--state", providerStatePath, "--worktree-root", worktreeRoot]);
const providerUrl = `http://127.0.0.1:${providerPort}`;
await waitReady(providerUrl);
let controlPort = await getPort();
let control = await start(new URL("./fake-control-plane-process.mjs", import.meta.url).pathname, ["--port", String(controlPort), "--state", statePath, "--provider-url", providerUrl]);
let controlUrl = `http://127.0.0.1:${controlPort}`;
await waitReady(controlUrl);
try {
  if (step === 11) {
    await stop(control);
    controlPort = await getPort();
    control = await start(new URL("./fake-control-plane-process.mjs", import.meta.url).pathname, ["--port", String(controlPort), "--state", statePath, "--provider-url", providerUrl]);
    controlUrl = `http://127.0.0.1:${controlPort}`;
    await waitReady(controlUrl);
  }
  const result = await post(`${controlUrl}/command`, { step, target: realTarget, modes: ["full-access-read", "full-access-write"] });
  if (step === 14) {
    const evidenceResponse = await fetch(`${controlUrl}/evidence`);
    const evidence = await evidenceResponse.json();
    if (!evidenceResponse.ok || evidence.bundle.bundleId !== evidence.report.evidenceBundleId || evidence.bundle.goalId !== evidence.report.goalId) throw new Error("fake evidence bundle/report identity mismatch");
    result.evidence = evidence;
  }
  const currentState = result.state ?? JSON.parse(await readFile(statePath, "utf8"));
  if (currentState.lastStep !== step) throw new Error(`fake Control Plane did not durably advance to step ${step}`);
  await writeFile(statePath, JSON.stringify(currentState, null, 2) + "\n");
  console.log(JSON.stringify({ step, observation: result.observation, providerCalls: currentState.providerCalls }));
} finally {
  await stop(control);
  await stop(provider);
}
