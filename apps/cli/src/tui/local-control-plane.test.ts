import { describe, expect, it, vi } from "vitest";
import { ensureLocalControlPlane } from "./local-control-plane.js";

describe("ensureLocalControlPlane", () => {
  it("reuses a healthy configured control plane", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
    await expect(ensureLocalControlPlane({ apiUrl: "http://127.0.0.1:4310", fetch })).resolves.toEqual({ kind: "ready", apiUrl: "http://127.0.0.1:4310" });
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:4310/healthz", expect.anything());
  });

  it("reports unavailable when the local server cannot be reached", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("connect refused"));
    await expect(ensureLocalControlPlane({ apiUrl: "http://127.0.0.1:4310", fetch })).resolves.toEqual({ kind: "unavailable", apiUrl: "http://127.0.0.1:4310", reason: "Control Plane is not reachable" });
  });

  it("returns unavailable when health check exceeds its bound", async () => {
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    await expect(ensureLocalControlPlane({ apiUrl: "http://127.0.0.1:4310", fetch, timeoutMs: 5 })).resolves.toMatchObject({ kind: "unavailable", reason: "Control Plane health check timed out" });
  });

  it("does not accept a non-success health response", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("down", { status: 503 }));
    await expect(ensureLocalControlPlane({ apiUrl: "http://127.0.0.1:4310", fetch })).resolves.toMatchObject({ kind: "unavailable" });
  });
});
