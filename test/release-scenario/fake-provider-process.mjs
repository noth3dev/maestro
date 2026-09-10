import { createServer } from "node:http";
import { execFile as execFileCallback } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { promisify } from "node:util";
import { assertReleaseScenarioTarget } from "./fixture.mjs";

const execFile = promisify(execFileCallback);
const args = parseArgs({ options: { port: { type: "string" }, state: { type: "string" }, "worktree-root": { type: "string" } } }).values;
const port = Number(args.port);
const statePath = args.state;
const worktreeRoot = args["worktree-root"];
if (!port || !statePath || !worktreeRoot) throw new Error("provider requires --port, --state, and --worktree-root");
let state;
try { state = JSON.parse(await readFile(statePath, "utf8")); } catch (error) { if (error?.code !== "ENOENT") throw new Error(`fake provider state is unreadable: ${error.message}`); state = { provider: "fake", calls: [], modelIdentities: ["fake/provider-a", "fake/provider-b"] }; }
const save = () => writeFile(statePath, JSON.stringify(state, null, 2) + "\n");
const body = async (request) => { let text = ""; for await (const chunk of request) text += chunk; return text === "" ? {} : JSON.parse(text); };
const json = (response, status, value) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(value)); };
const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") return json(response, 200, { ok: true, pid: process.pid });
    if (request.method === "GET" && request.url === "/state") return json(response, 200, state);
    if (request.method !== "POST" || request.url !== "/execute") return json(response, 404, { error: "not_found" });
    const input = await body(request);
    const target = await assertReleaseScenarioTarget(input.target, worktreeRoot);
    const call = { callId: randomUUID(), operation: input.operation, target, at: new Date().toISOString() };
    state.calls.push(call);
    let result;
    if (input.operation === "test") {
      try { await execFile("npm", ["test", "--prefix", target]); result = { exitCode: 0 }; } catch (error) { result = { exitCode: error.code ?? 1 }; }
    } else if (["inject", "clear", "repair"].includes(input.operation)) {
      const script = { inject: "inject-unsupported-assertion.mjs", clear: "clear-unsupported-assertion.mjs", repair: "repair-seeded-defect.mjs" }[input.operation];
      const output = await execFile("node", [`${target}/scripts/${script}`]);
      result = { exitCode: 0, stdout: output.stdout.trim() };
    } else if (input.operation === "revision") {
      const output = await execFile("git", ["-C", target, "rev-parse", "HEAD"]);
      result = { exitCode: 0, revision: output.stdout.trim() };
    } else if (input.operation === "mode") {
      if (!["retain_intermediate_approvals", "skip_intermediate_approvals"].includes(input.mode)) throw new Error("unsupported provider mode");
      state.mode = input.mode;
      state.modeChanges = [...(state.modeChanges ?? []), input.mode];
      result = { exitCode: 0, mode: state.mode };
    } else if (input.operation === "remote") {
      const mode = state.mode ?? "approval-required";
      const blocked = { blocked: true, networkInvoked: false, mode, reason: "remote push requires explicit user approval" };
      state.remoteAttempts = [...(state.remoteAttempts ?? []), blocked];
      result = { exitCode: 0, ...blocked };
    } else {
      throw new Error(`unsupported fake provider operation: ${input.operation}`);
    }
    await save();
    return json(response, 200, { result, modelIdentities: state.modelIdentities, callCount: state.calls.length });
  } catch (error) { return json(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
});
server.listen(port, "127.0.0.1", () => console.log(`READY ${port}`));
