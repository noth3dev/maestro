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
try { state = JSON.parse(await readFile(statePath, "utf8")); } catch { state = { provider: "fake", calls: [], modelIdentities: ["fake/provider-a", "fake/provider-b"] }; }
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
    } else if (["inject", "clear", "repair", "remote"].includes(input.operation)) {
      const script = { inject: "inject-unsupported-assertion.mjs", clear: "clear-unsupported-assertion.mjs", repair: "repair-seeded-defect.mjs", remote: "attempt-remote-push.mjs" }[input.operation];
      const output = await execFile("node", [`${target}/scripts/${script}`]);
      result = { exitCode: 0, stdout: output.stdout.trim() };
    } else if (input.operation === "revision") {
      const output = await execFile("git", ["-C", target, "rev-parse", "HEAD"]);
      result = { exitCode: 0, revision: output.stdout.trim() };
    } else if (input.operation === "mode") {
      result = { exitCode: 0, mode: input.mode };
    } else {
      throw new Error(`unsupported fake provider operation: ${input.operation}`);
    }
    await save();
    return json(response, 200, { result, modelIdentities: state.modelIdentities, callCount: state.calls.length });
  } catch (error) { return json(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
});
server.listen(port, "127.0.0.1", () => console.log(`READY ${port}`));
