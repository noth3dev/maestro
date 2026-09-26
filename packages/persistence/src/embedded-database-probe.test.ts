import { createServer, type Socket } from "node:net";
import { describe, expect, it } from "vitest";
import { probeEmbeddedDatabase } from "./embedded-database-probe.js";

function backendMessage(type: string, payload: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length + 4);
  return Buffer.concat([Buffer.from(type), length, payload]);
}

describe("embedded database probe", () => {
  it("bounds a stalled PostgreSQL startup handshake by the remaining deadline", async () => {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Could not allocate a local TCP port");
    const startedAt = Date.now();
    try {
      await expect(probeEmbeddedDatabase(`postgresql://postgres:postgres@127.0.0.1:${address.port}/postgres`, 50)).resolves.toBe(false);
      expect(Date.now() - startedAt).toBeLessThan(1_000);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close((error) => (error === undefined ? resolve() : reject(error))));
    }
  });

  it("finishes a successful probe without waiting for the peer to close", async () => {
    const sockets = new Set<Socket>();
    let peerEnded = false;
    let resolvePeerEnded!: () => void;
    const peerEndedPromise = new Promise<void>((resolve) => {
      resolvePeerEnded = resolve;
    });
    const server = createServer({ allowHalfOpen: true }, (socket) => {
      sockets.add(socket);
      socket.once("end", () => {
        peerEnded = true;
        resolvePeerEnded();
      });
      socket.once("close", () => {
        sockets.delete(socket);
        resolvePeerEnded();
      });
      let input = Buffer.alloc(0);
      let receivedStartup = false;
      socket.on("data", (chunk) => {
        input = Buffer.concat([input, chunk]);
        if (!receivedStartup) {
          if (input.length < 4) return;
          const startupLength = input.readUInt32BE(0);
          if (input.length < startupLength) return;
          input = input.subarray(startupLength);
          receivedStartup = true;
          const authenticationPayload = Buffer.alloc(4);
          const authOk = backendMessage("R", authenticationPayload);
          const ready = backendMessage("Z", Buffer.from("I"));
          socket.write(Buffer.concat([authOk, ready]));
        }
        while (input.length >= 5) {
          const messageLength = input.readUInt32BE(1);
          if (input.length < messageLength + 1) return;
          const type = String.fromCharCode(input[0]!);
          input = input.subarray(messageLength + 1);
          if (type === "Q") {
            const complete = backendMessage("C", Buffer.from("SELECT 1\0"));
            const ready = backendMessage("Z", Buffer.from("I"));
            socket.write(Buffer.concat([complete, ready]));
          }
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Could not allocate a local TCP port");
    let probe: Promise<boolean> | undefined;
    let probeTimeout: ReturnType<typeof setTimeout> | undefined;
    let closeTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        (probe = probeEmbeddedDatabase(`postgresql://postgres:postgres@127.0.0.1:${address.port}/postgres?sslmode=disable`, 500)),
        new Promise<"timed out">((resolve) => {
          probeTimeout = setTimeout(() => resolve("timed out"), 1_000);
        }),
      ]);
      expect(result).toBe(true);
      await Promise.race([
        peerEndedPromise,
        new Promise<never>((_, reject) => {
          closeTimeout = setTimeout(() => reject(new Error("Probe did not close its client connection")), 500);
        }),
      ]);
      expect(peerEnded).toBe(true);
    } finally {
      if (probeTimeout !== undefined) clearTimeout(probeTimeout);
      if (closeTimeout !== undefined) clearTimeout(closeTimeout);
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close((error) => (error === undefined ? resolve() : reject(error))));
      await probe?.catch(() => false);
    }
  });
});
