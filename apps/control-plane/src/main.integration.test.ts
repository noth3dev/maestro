import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrapLocalOperator } from "@maestro/persistence";
import { createControlPlane } from "./main.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;

if (!databaseUrl) {
  describe.skip("control-plane composition root", () => {
    it("requires MAESTRO_TEST_DATABASE_URL", () => {});
  });
} else {
  describe("control-plane composition root", () => {
  const schema = `control_plane_${randomUUID().replaceAll("-", "")}`;
  const basePool = new Pool({ connectionString: databaseUrl });
  const scopedUrl = (() => {
    const url = new URL(databaseUrl!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    return url.toString();
  })();
  let setupPool: Pool;

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    setupPool = new Pool({ connectionString: scopedUrl });
    for (const name of [
      "0001_phase1_core.sql",
      "0002_goal_leases.sql",
      "0003_local_operator_auth.sql",
      "0004_local_operator_credential_security.sql",
    ]) {
      await setupPool.query(await readFile(fileURLToPath(new URL(`../../../packages/persistence/migrations/${name}`, import.meta.url)), "utf8"));
    }
  });

  beforeEach(async () => {
    await setupPool.query("TRUNCATE goal_leases, outbox, goal_events, command_receipts, goals, local_operator_credentials, local_operators CASCADE");
  });

  afterAll(async () => {
    await setupPool.end();
    await basePool.query(`DROP SCHEMA ${schema} CASCADE`);
    await basePool.end();
  });

  it("serves authenticated durable Goal operations over a real loopback listener and closes resources", async () => {
    const secret = "integration-secret-not-configured";
    await bootstrapLocalOperator(setupPool, { secret });
    const controlPlane = createControlPlane({
      databaseUrl: scopedUrl,
      evidenceDir: "/tmp/maestro-evidence",
      host: "127.0.0.1",
      port: 0,
      primeAgentVersion: "0.8.0",
      actorId: "maestro-control-plane",
      leaseOwnerId: `test-${randomUUID()}`,
    });
    await controlPlane.listen();
    const address = controlPlane.app.server.address();
    if (address === null || typeof address === "string") throw new Error("Expected TCP listener");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const projectId = randomUUID();
    const goalId = randomUUID();

    try {
      const unauthorized = await fetch(`${baseUrl}/v1/goals`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": goalId },
        body: JSON.stringify({ projectId }),
      });
      expect(unauthorized.status).toBe(401);
      expect((await setupPool.query("SELECT count(*)::int AS count FROM goals")).rows[0]!.count).toBe(0);

      const headers = {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
        "idempotency-key": goalId,
      };
      const created = await fetch(`${baseUrl}/v1/goals`, { method: "POST", headers, body: JSON.stringify({ projectId }) });
      expect(created.status).toBe(201);
      expect(await created.json()).toMatchObject({ goalId, projectId, state: "draft", version: 1 });

      const transitioned = await fetch(`${baseUrl}/v1/goals/${goalId}/transitions`, {
        method: "POST",
        headers: { ...headers, "idempotency-key": randomUUID() },
        body: JSON.stringify({ projectId, expectedVersion: 1, to: "ready_for_confirmation" }),
      });
      expect(transitioned.status).toBe(200);
      expect(await transitioned.json()).toMatchObject({ goalId, projectId, state: "ready_for_confirmation", version: 2 });

      const read = await fetch(`${baseUrl}/v1/goals/${goalId}?projectId=${projectId}`, { headers: { authorization: `Bearer ${secret}` } });
      expect(read.status).toBe(200);
      expect(await read.json()).toMatchObject({ goalId, projectId, state: "ready_for_confirmation", version: 2 });
    } finally {
      await controlPlane.close();
    }

    await expect(controlPlane.pool.query("SELECT 1")).rejects.toThrow();
  });

  it("streams durable replay over loopback, resumes without duplicate IDs, and stops on disconnect", async () => {
    const secret = "sse-secret-not-configured";
    await bootstrapLocalOperator(setupPool, { secret });
    const controlPlane = createControlPlane({ databaseUrl: scopedUrl, evidenceDir: "/tmp/maestro-evidence", host: "127.0.0.1", port: 0, primeAgentVersion: "0.8.0", actorId: "maestro-control-plane", leaseOwnerId: `sse-${randomUUID()}` });
    await controlPlane.listen();
    const address = controlPlane.app.server.address();
    if (address === null || typeof address === "string") throw new Error("Expected TCP listener");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const projectId = randomUUID();
    const headers = { authorization: `Bearer ${secret}`, "content-type": "application/json" };
    const create = async (goalId: string) => fetch(`${baseUrl}/v1/goals`, { method: "POST", headers: { ...headers, "idempotency-key": goalId }, body: JSON.stringify({ projectId }) });
    const readChunk = async (reader: ReadableStreamDefaultReader<Uint8Array>, label: string) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 1_000); }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    };
    const readUntil = async (reader: ReadableStreamDefaultReader<Uint8Array>, predicate: (text: string) => boolean, label: string) => {
      const decoder = new TextDecoder();
      let text = "";
      while (!predicate(text)) {
        const chunk = await readChunk(reader, label);
        if (chunk.done) throw new Error(`SSE closed while waiting for ${label}`);
        text += decoder.decode(chunk.value, { stream: true });
      }
      return text;
    };
    try {
      await create(randomUUID());
      await create(randomUUID());
      const first = await fetch(`${baseUrl}/v1/events/stream?projectId=${projectId}&after=0`, { headers });
      expect(first.status).toBe(200);
      const firstReader = first.body!.getReader();
      const firstText = await readUntil(firstReader, (text) => [...text.matchAll(/^id: (.+)$/gm)].length === 2, "initial replay");
      const ids = [...firstText.matchAll(/^id: (.+)$/gm)].map((match) => match[1]!);
      expect(ids).toHaveLength(2);
      await firstReader.cancel();

      const resumed = await fetch(`${baseUrl}/v1/events/stream?projectId=${projectId}&after=${ids[0]}`, { headers: { ...headers, "last-event-id": ids[0]! } });
      const resumedReader = resumed.body!.getReader();
      const resumedText = await readUntil(resumedReader, (text) => /^id: /m.test(text), "resumed event");
      expect([...resumedText.matchAll(/^id: (.+)$/gm)].map((match) => match[1]!)).toEqual([ids[1]]);
      await resumedReader.cancel();

      const empty = await fetch(`${baseUrl}/v1/events/stream?projectId=${projectId}&after=${ids[1]}`, { headers });
      const emptyReader = empty.body!.getReader();
      const heartbeat = await readUntil(emptyReader, (text) => text.includes(": heartbeat\n\n"), "heartbeat");
      expect(heartbeat).toContain(": heartbeat\n\n");
      await create(randomUUID());
      const later = await readUntil(emptyReader, (text) => text.includes("event: goal-event"), "polled event");
      expect(later).toContain("event: goal-event");
      expect(later).not.toContain(`id: ${ids[1]}`);
      await emptyReader.cancel();
      await controlPlane.close();
      await expect(controlPlane.pool.query("SELECT 1")).rejects.toThrow();
    } finally {
      await controlPlane.close();
    }
  });

  it("closes an open raw SSE response within a bounded interval", async () => {
    const secret = "sse-close-secret-not-configured";
    await bootstrapLocalOperator(setupPool, { secret });
    const controlPlane = createControlPlane({ databaseUrl: scopedUrl, evidenceDir: "/tmp/maestro-evidence", host: "127.0.0.1", port: 0, primeAgentVersion: "0.8.0", actorId: "maestro-control-plane", leaseOwnerId: `sse-close-${randomUUID()}` });
    await controlPlane.listen();
    const address = controlPlane.app.server.address();
    if (address === null || typeof address === "string") throw new Error("Expected TCP listener");
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/events/stream?projectId=${randomUUID()}`, { headers: { authorization: `Bearer ${secret}` } });
    const reader = response.body!.getReader();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await expect(Promise.race([
        controlPlane.close(),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("app.close did not release open SSE")), 1_000); }),
      ])).resolves.toBeUndefined();
      let readerTimeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          (async () => {
            while (!(await reader.read()).done) {
              // A response may have buffered bytes. It must still reach EOF after app.close().
            }
          })(),
          new Promise<never>((_, reject) => { readerTimeout = setTimeout(() => reject(new Error("SSE reader did not close")), 1_000); }),
        ]);
      } finally {
        if (readerTimeout) clearTimeout(readerTimeout);
      }
    } finally {
      if (timeout) clearTimeout(timeout);
      await reader.cancel().catch(() => undefined);
      await controlPlane.close();
    }
  });

});
}
