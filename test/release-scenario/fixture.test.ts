import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createReleaseScenarioFixture } from "./fixture.mjs";

describe("release scenario fixture", () => {
  it("creates a disposable real project with defect, repair, injection, restart, and blocked-action fixtures", async () => {
    const root = await mkdtemp(join(tmpdir(), "maestro-release-scenario-test-"));
    const fixture = await createReleaseScenarioFixture({ root });

    expect(fixture.root).toBe(root);
    expect(await readFile(join(root, ".git", "HEAD"), "utf8")).toContain("refs/heads");
    expect(await readFile(fixture.targetTest, "utf8")).toContain("discount");
    expect(await readFile(fixture.seededDefect, "utf8")).toContain("seeded defect");
    expect(await readFile(fixture.repairedImplementation, "utf8")).toContain("repaired counterpart");
    expect(await readFile(fixture.unsupportedAssertion, "utf8")).toContain("unsupported assertion");
    expect(await readFile(fixture.restartTrigger, "utf8")).toContain("restart");
    expect(await readFile(fixture.ambiguousAction, "utf8")).toContain("ambiguous");
    expect(await readFile(fixture.remotePushAttempt, "utf8")).toContain("blocked");
    await rm(root, { recursive: true, force: true });
  });
});
