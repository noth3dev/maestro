import net from "node:net";

let next = 0;
const invocations = new Map();

function reply(socket, id, value) {
  socket.write(`${JSON.stringify({ id, ...value })}\n`);
}

function handle(socket, request) {
  try {
    if (request.op === "spawn") {
      next += 1;
      const execution = `provider-execution-${next}`;
      const invocation = `provider-invocation-${next}`;
      invocations.set(invocation, { execution, name: request.name, status: "running" });
      reply(socket, request.id, { execution, invocation });
    } else if (request.op === "prompt") {
      reply(socket, request.id, { ok: true });
    } else if (request.op === "observe") {
      const observations = [...invocations.entries()]
        .filter(([, value]) => value.execution === request.execution)
        .map(([invocation, value]) => ({
          invocation, name: value.name, status: value.status,
          toolEvents: { state: "empty", events: [] }, usage: { state: "unknown" },
          answer: { state: "unavailable", reason: "provider-does-not-expose-answer-text" },
        }));
      reply(socket, request.id, { observations });
    } else if (request.op === "cancel") {
      const invocation = invocations.get(request.invocation);
      if (invocation === undefined || invocation.status === "cancelled") reply(socket, request.id, { cancelled: false });
      else { invocation.status = "cancelled"; reply(socket, request.id, { cancelled: true }); }
    } else if (request.op === "stats") {
      reply(socket, request.id, { spawnCount: next, invocations: [...invocations.entries()] });
    } else {
      reply(socket, request.id, { error: "unsupported-operation" });
    }
  } catch (error) {
    reply(socket, request.id, { error: error instanceof Error ? error.message : String(error) });
  }
}

const server = net.createServer((socket) => {
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line === "") continue;
      try { handle(socket, JSON.parse(line)); }
      catch { socket.write(`${JSON.stringify({ error: "invalid-json" })}\n`); }
    }
  });
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("provider did not bind TCP port");
  process.stdout.write(`${JSON.stringify({ ready: true, port: address.port })}\n`);
});

process.once("SIGTERM", () => server.close(() => process.exit(0)));
