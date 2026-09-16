import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REQUIRED_SOAK_CONTENTS, replaySoakReport, runSoak, validateSoakReport } from "../../scripts/run-soak.mjs";

const options = {
  fixtureId: "phase8-s8-red-green",
  seed: 7,
  durationMs: 24,
  sampleIntervalMs: 2,
  goalCount: 3,
  timelineOrigin: "2026-09-16T00:00:00.000Z",
};

describe("Plan 8 §S8 soak runner", () => {
  it("samples concurrent obligations and every required long-running operation", async () => {
    const report = await runSoak(options);

    expect(report.status).toBe("completed");
    expect(report.mode).toBe("disposable-fixture");
    expect(report.samples.length).toBeGreaterThanOrEqual(8);
    expect(report.coverage.contents).toEqual(REQUIRED_SOAK_CONTENTS);
    expect(report.boundaries.provider.live).toBe(false);
    expect(report.boundaries.discord.live).toBe(false);
    expect(report.fixture.candidateId).toBe("phase8-s8-disposable-candidate-v1");
    expect(report.events.map((event) => event.kind)).toEqual(
      expect.arrayContaining([
        "concurrent-goals",
        "idle-evaluation",
        "app-disconnect",
        "app-reconnect",
        "provider-rotation",
        "provider-unavailable",
        "control-plane-restart",
        "discord-probe",
        "persona-evidence",
        "resource-cost-storage-sample",
      ]),
    );
    for (const kind of ["idle-evaluation", "discord-probe", "persona-evidence", "resource-cost-storage-sample"]) {
      expect(report.events.filter((event) => event.kind === kind)).toHaveLength(report.samples.length);
    }
    expect(report.assertions.violations).toEqual([]);
    expect(report.assertions.idleObligationSamples).toBe(report.samples.length);
    expect(report.assertions.scopeSamples).toBe(report.samples.length);
    expect(report.assertions.personaBoundSamples).toBe(report.samples.length);
  });

  it("holds no-idle and scope-expiry gates at every sampled point", async () => {
    const report = await runSoak({ ...options, durationMs: 32 });

    for (const sample of report.samples) {
      for (const goal of sample.goals) {
        if (goal.head.active) expect(goal.head.obligationId).toBeDefined();
        for (const worker of goal.workers) if (worker.active) expect(worker.obligationId).toBeDefined();
      }
      for (const scope of sample.scopes) {
        expect(scope.active).toBe(sample.observedAt < scope.expiresAt);
      }
    }
    expect(report.assertions.scopeLeaks).toEqual([]);
  });

  it("keeps persona task-class drift within its declared bound over the window", async () => {
    const report = await runSoak({ ...options, durationMs: 40, personaDriftBound: 0.1 });

    expect(report.persona.maxAbsoluteDrift).toBeLessThanOrEqual(report.persona.declaredBound);
    expect(report.persona.samples).toHaveLength(report.samples.length);
    expect(report.assertions.personaBoundSamples).toBe(report.samples.length);
  });

  it("rejects timer-overflow configurations instead of claiming a false soak window", async () => {
    await expect(runSoak({ durationMs: 15_032_385_536, sampleIntervalMs: 2_147_483_648 })).rejects.toThrow(/timer limit/);
  });

  it("writes a durable report and reproduces it from the recorded fixture identity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maestro-s8-"));
    const reportPath = join(directory, "soak-report.json");
    const report = await runSoak({ ...options, reportPath });
    const persisted = JSON.parse(await readFile(reportPath, "utf8"));
    const fileMode = (await stat(reportPath)).mode & 0o777;
    const replay = await replaySoakReport(report);
    const differentSeed = await runSoak({ ...options, seed: 8 });

    expect(persisted).toEqual(report);
    expect(fileMode).toBe(0o600);
    expect(validateSoakReport(persisted)).toEqual(report);
    expect(replay.observationDigest).toBe(report.observationDigest);
    expect(replay.contentHash).toBe(report.contentHash);
    expect(differentSeed.observationDigest).not.toBe(report.observationDigest);
    await expect(runSoak({ ...options, reportPath })).rejects.toThrow(/overwrite/);
    await expect(runSoak({ ...options, reportPath, force: true })).resolves.toMatchObject({ contentHash: report.contentHash });

    const concurrentPath = join(directory, "concurrent-report.json");
    const concurrent = await Promise.allSettled([
      runSoak({ ...options, reportPath: concurrentPath, seed: 1 }),
      runSoak({ ...options, reportPath: concurrentPath, seed: 2 }),
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === "rejected")[0]?.reason).toMatchObject({
      message: expect.stringMatching(/overwrite|already being written/),
    });

    const tampered = structuredClone(report);
    tampered.samples[0].metrics.costCents += 1;
    expect(() => validateSoakReport(tampered)).toThrow(/hash|digest|reproduc/i);
  });
});
