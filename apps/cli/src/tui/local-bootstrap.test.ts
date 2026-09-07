import { describe, expect, it, vi } from "vitest";
import { resolveLocalConnection, type LocalSecretStore } from "./local-bootstrap.js";

function secretStore(initial?: string): LocalSecretStore {
  let value = initial;
  return {
    read: () => value,
    write: (next) => { value = next; },
    clear: () => { value = undefined; },
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("resolveLocalConnection", () => {
  it("reuses a keychain token and repairs a missing default Goal", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ status: "ok" }))
      .mockResolvedValueOnce(response({ projects: ["11111111-1111-4111-8111-111111111111"] }))
      .mockResolvedValueOnce(response({ goals: [] }))
      .mockResolvedValueOnce(response({ goalId: "22222222-2222-4222-8222-222222222222", projectId: "11111111-1111-4111-8111-111111111111", state: "draft", version: 1 }, 201));
    const store = secretStore("credential.secret");
    const runCommand = vi.fn();

    await expect(resolveLocalConnection({ env: {}, fetch, secretStore: store, runCommand })).resolves.toEqual({
      kind: "configured",
      apiUrl: "http://127.0.0.1:4310",
      token: "credential.secret",
    });
    expect(runCommand).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("reuses a keychain token after restarting the local Control Plane", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockResolvedValueOnce(response({ status: "ok" }))
      .mockResolvedValueOnce(response({ projects: [projectId] }))
      .mockResolvedValueOnce(response({ goals: [{ goalId: "22222222-2222-4222-8222-222222222222", projectId, state: "draft", version: 1 }] }));
    const runCommand = vi.fn(async (file: string, args: readonly string[]) => {
      if (file === "docker" && args[0] === "inspect") return { code: 0, stdout: "true", stderr: "" };
      if (file === "docker" && args[0] === "exec") return { code: 0, stdout: "accepting connections", stderr: "" };
      throw new Error(`unexpected command: ${file} ${args.join(" ")}`);
    });
    const startControlPlane = vi.fn(async () => undefined);

    await expect(resolveLocalConnection({ env: {}, fetch, secretStore: secretStore("credential.secret"), runCommand, startControlPlane, retryDelayMs: 0 })).resolves.toEqual({
      kind: "configured",
      apiUrl: "http://127.0.0.1:4310",
      token: "credential.secret",
    });
    expect(startControlPlane).not.toHaveBeenCalled();
    expect(runCommand).not.toHaveBeenCalledWith(process.execPath, expect.anything(), expect.anything());
  });

  it("starts Docker PostgreSQL and Control Plane, bootstraps auth, and creates a default Goal", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockResolvedValueOnce(response({ status: "ok" }))
      .mockResolvedValueOnce(response({ projects: [projectId] }))
      .mockResolvedValueOnce(response({ goals: [] }))
      .mockResolvedValueOnce(response({ goalId: "22222222-2222-4222-8222-222222222222", projectId, state: "draft", version: 1 }, 201));
    const store = secretStore();
    const runCommand = vi.fn(async (file: string, args: readonly string[], options?: { env?: Record<string, string | undefined> }) => {
      if (file === "docker" && args[0] === "inspect") return { code: 1, stdout: "", stderr: "not found" };
      if (file === "docker" && args[0] === "run") return { code: 0, stdout: "container-id", stderr: "" };
      if (file === "docker" && args[0] === "exec") return { code: 0, stdout: "accepting connections", stderr: "" };
      if (file === process.execPath && args.some((arg) => arg.endsWith("local-bootstrap.js"))) {
        expect(options?.env?.MAESTRO_LOCAL_BOOTSTRAP_SECRET).toBeTruthy();
        return { code: 0, stdout: JSON.stringify({ operatorId: "33333333-3333-4333-8333-333333333333", credentialId: "44444444-4444-4444-8444-444444444444", projectId }), stderr: "" };
      }
      throw new Error(`unexpected command: ${file} ${args.join(" ")}`);
    });
    const startControlPlane = vi.fn(async () => undefined);

    const result = await resolveLocalConnection({ env: {}, fetch, secretStore: store, runCommand, startControlPlane, retryDelayMs: 0 });
    expect(result.kind).toBe("configured");
    if (result.kind === "configured") {
      expect(result.apiUrl).toBe("http://127.0.0.1:4310");
      expect(result.token).toMatch(/^44444444-4444-4444-8444-444444444444\./);
      expect(store.read()).toBe(result.token);
    }
    expect(startControlPlane).toHaveBeenCalledOnce();
    expect(runCommand).toHaveBeenCalledWith("docker", expect.arrayContaining(["run"]));
  });

  it("returns actionable guidance when Docker is unavailable", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("connection refused"));
    const runCommand = vi.fn(async () => ({ code: 127, stdout: "", stderr: "docker: command not found" }));

    await expect(resolveLocalConnection({ env: {}, fetch, secretStore: secretStore(), runCommand, retryDelayMs: 0 })).resolves.toMatchObject({
      kind: "setup-required",
      reason: expect.stringContaining("Docker"),
    });
  });
});
