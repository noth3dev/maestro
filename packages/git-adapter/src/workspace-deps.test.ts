import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GitOperationError } from "@maestro/domain";
import type { AuthorityDecision } from "@maestro/authority";
import { GitAuthorizationError, GitOutcomeUnknownError } from "./index.js";

const decision = {
  effect: "deny",
  reason: "test-denied",
  classification: "forbidden",
  request: {},
} as unknown as AuthorityDecision;

describe("workspace dependency identity", () => {
  it("shares one @maestro/domain error identity across the package boundary", () => {
    expect(new GitAuthorizationError(decision)).toBeInstanceOf(GitOperationError);
    expect(new GitOutcomeUnknownError(decision)).toBeInstanceOf(GitOperationError);
    expect(new GitAuthorizationError(decision).name).toBe("GitAuthorizationError");
  });

  it("keeps workspace deps on the shared convention, never a file: copy", () => {
    const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
    const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    for (const [name, specifier] of Object.entries(manifest.dependencies ?? {})) {
      expect(specifier.startsWith("file:"), `${name} must use the workspace convention, not a file: copy`).toBe(false);
    }
  });

  it("is not vacuous: a structurally identical lookalike is not instanceof", () => {
    class LookalikeGitOperationError extends Error {}
    expect(new GitAuthorizationError(decision)).not.toBeInstanceOf(LookalikeGitOperationError);
    expect(new GitOutcomeUnknownError(decision)).not.toBeInstanceOf(LookalikeGitOperationError);
  });
});
