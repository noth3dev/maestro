import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ActionRequest, AuthorityDecision } from "@maestro/authority";
import { createAuthorizedReadOnlyFilePort, type ReadOnlyFileAuthorityGateway } from "./read-only-file-adapter.js";

function gateway(decision: "allow" | "deny" = "allow"): ReadOnlyFileAuthorityGateway & { requests: ActionRequest[] } {
  const requests: ActionRequest[] = [];
  return {
    requests,
    async execute(request, effect): Promise<AuthorityDecision> {
      requests.push(request);
      if (decision === "deny") return { effect: "deny", reason: "no_grant", classification: "ordinary", request };
      await effect();
      return { effect: "allow", reason: "exact_grant", classification: "ordinary", request, recordId: "grant-1", expiresAt: new Date("2030-01-01") };
    },
  };
}

const context = { commandId: "command-1", projectId: "project-1", actorId: "operator-1", goalId: "goal-1", policyVersion: 1, budgetEffectCents: 0, controlEpoch: "epoch-1" } as const;

describe("authorized read-only file adapter", () => {
  it("reads UTF-8 project evidence only after exact authority execution", async () => {
    const root = await mkdtemp(join(tmpdir(), "maestro-read-"));
    try {
      await mkdir(join(root, "docs"));
      await writeFile(join(root, "docs", "README.md"), "hello\n", "utf8");
      const authority = gateway();
      const port = createAuthorizedReadOnlyFilePort({ authority, context, workspaceRoot: root });

      await expect(port.readFile("docs/README.md")).resolves.toBe("hello\n");
      expect(authority.requests[0]).toMatchObject({ action: "project.file.read", projectId: "project-1", goalId: "goal-1", controlEpoch: "epoch-1" });
      expect(JSON.parse(authority.requests[0].target)).toEqual([join(root, "docs", "README.md")]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("enforces the Goal path scope inside the configured workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "maestro-read-"));
    try {
      await mkdir(join(root, "scoped"));
      await writeFile(join(root, "README.md"), "root", "utf8");
      await writeFile(join(root, "scoped", "README.md"), "scoped", "utf8");
      const port = createAuthorizedReadOnlyFilePort({ authority: gateway(), context, workspaceRoot: root, pathScope: ["scoped"] });
      await expect(port.readFile("scoped/README.md")).resolves.toBe("scoped");
      await expect(port.readFile("README.md")).rejects.toThrow("outside");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("rejects a symlink that escapes the workspace and Git metadata paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "maestro-read-"));
    const outside = await mkdtemp(join(tmpdir(), "maestro-outside-"));
    try {
      await writeFile(join(outside, "secret.txt"), "outside", "utf8");
      await symlink(outside, join(root, "link"), "dir");
      const port = createAuthorizedReadOnlyFilePort({ authority: gateway(), context, workspaceRoot: root });
      await expect(port.readFile("link/secret.txt")).rejects.toThrow("outside");
      await expect(port.readFile(".git/config")).rejects.toThrow("sensitive");
    } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
  });

  it("rejects invalid UTF-8 instead of returning replacement characters", async () => {
    const root = await mkdtemp(join(tmpdir(), "maestro-read-"));
    try {
      await writeFile(join(root, "binary.bin"), Buffer.from([0xff, 0xfe]));
      const port = createAuthorizedReadOnlyFilePort({ authority: gateway(), context, workspaceRoot: root });
      await expect(port.readFile("binary.bin")).rejects.toThrow("UTF-8");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("rejects a non-sensitive symlink name that resolves to a sensitive file", async () => {
    const root = await mkdtemp(join(tmpdir(), "maestro-read-"));
    try {
      await writeFile(join(root, ".env"), "SECRET=bad", "utf8");
      await symlink(join(root, ".env"), join(root, "public-link"), "file");
      const port = createAuthorizedReadOnlyFilePort({ authority: gateway(), context, workspaceRoot: root });
      await expect(port.readFile("public-link")).rejects.toThrow("sensitive");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("fails closed for denied authority, traversal, sensitive paths, and oversized files", async () => {
    const root = await mkdtemp(join(tmpdir(), "maestro-read-"));
    try {
      await writeFile(join(root, "README.md"), "hello", "utf8");
      await writeFile(join(root, ".env"), "SECRET=bad", "utf8");
      const denied = gateway("deny");
      const deniedPort = createAuthorizedReadOnlyFilePort({ authority: denied, context, workspaceRoot: root });
      await expect(deniedPort.readFile("README.md")).rejects.toThrow("not authorized");
      await expect(deniedPort.readFile("../outside")).rejects.toThrow("outside");
      await expect(deniedPort.readFile(".env")).rejects.toThrow("sensitive");
      const bytes = await readFile(join(root, "README.md"));
      expect(bytes.toString()).toBe("hello");
      const oversized = createAuthorizedReadOnlyFilePort({ authority: gateway(), context, workspaceRoot: root, maxBytes: 3 });
      await expect(oversized.readFile("README.md")).rejects.toThrow("output limit");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
