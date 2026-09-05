import net from "node:net";
import { createControlPlane } from "../dist/main.js";

class SocketExecutionKernel {
  constructor(port) {
    this.nextRequest = 0;
    this.buffer = "";
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    this.socket = net.createConnection({ host: "127.0.0.1", port }, () => this.resolveReady());
    this.socket.setEncoding("utf8");
    this.socket.on("data", (chunk) => this.acceptOutput(chunk));
    this.socket.on("error", (error) => { this.rejectReady(error); this.rejectAll(error); });
    this.socket.on("close", () => this.rejectAll(new Error("provider socket closed")));
  }

  acceptOutput(chunk) {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line === "") continue;
      const response = JSON.parse(line);
      const waiter = this.pending.get(response.id);
      if (waiter === undefined) continue;
      this.pending.delete(response.id);
      if (typeof response.error === "string") waiter.reject(new Error(response.error));
      else waiter.resolve(response);
    }
  }

  rejectAll(error) {
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
  }

  async request(op, payload = {}) {
    await this.ready;
    const id = ++this.nextRequest;
    const response = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.socket.write(`${JSON.stringify({ id, op, ...payload })}\n`);
    return response;
  }

  async spawn(request) {
    const response = await this.request("spawn", { name: request.name });
    const delayMs = Number(process.env.MAESTRO_TEST_SPAWN_RETURN_DELAY_MS ?? "0");
    if (Number.isFinite(delayMs) && delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return { execution: response.execution, invocation: response.invocation };
  }
  async prompt(execution, text) { await this.request("prompt", { execution, text }); }
  async observe(execution) { return (await this.request("observe", { execution })).observations; }
  async sendMessage() { throw new Error("not used"); }
  async cancel(invocation) { return await this.request("cancel", { invocation }); }
  async getModelIdentity() { return { provider: "process-test-provider", id: "process-test-provider" }; }
  async getToolEvents() { return { state: "empty", events: [] }; }
  async getUsage() { return { state: "unknown" }; }
  async getInvocationStatus() { return "running"; }
  async resume() { throw new Error("resume is not supported"); }
  async reconnect() { throw new Error("reconnect is not supported"); }
  async release() {}
  async close() { this.socket.end(); }
}

const config = JSON.parse(process.env.MAESTRO_CONTROL_PLANE_CONFIG);
const kernel = new SocketExecutionKernel(Number(process.env.MAESTRO_PROVIDER_PORT));
let controlPlane;
let closing = false;

async function shutdown() {
  if (closing) return;
  closing = true;
  try { await controlPlane?.close(); }
  finally { process.exit(0); }
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

try {
  controlPlane = createControlPlane(config, { executionKernel: kernel });
  await controlPlane.listen();
  const address = controlPlane.app.server.address();
  if (address === null || typeof address === "string") throw new Error("control plane did not bind TCP port");
  process.stdout.write(`${JSON.stringify({ ready: true, port: address.port })}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
}
