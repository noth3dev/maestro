#!/usr/bin/env node
import { parseArgs } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SOAK_REPORT_SCHEMA_VERSION = 1;
export const REQUIRED_SOAK_CONTENTS = Object.freeze([
  "concurrent-goals",
  "idle-improvement-evaluation",
  "app-disconnect-reconnect",
  "provider-rotation-unavailability",
  "control-plane-restart",
  "discord-probes",
  "persona-evidence-drift",
  "resource-cost-storage-monitoring",
]);

const DEFAULTS = Object.freeze({
  durationMs: 30_000,
  sampleIntervalMs: 1_000,
  goalCount: 3,
  fixtureId: "phase8-s8-disposable-fixture",
  candidateId: "phase8-s8-disposable-candidate-v1",
  seed: 1,
  timelineOrigin: "2026-09-16T00:00:00.000Z",
  personaDriftBound: 0.1,
});
const MAX_SAMPLES = 100_000;
const MAX_TIMER_MS = 2_147_483_647;
const SOAK_EVENT_KINDS = Object.freeze([
  "concurrent-goals",
  "app-disconnect",
  "app-reconnect",
  "provider-rotation",
  "provider-unavailable",
  "control-plane-restart",
  "idle-evaluation",
  "discord-probe",
  "persona-evidence",
  "resource-cost-storage-sample",
]);
const SOAK_ONE_OFF_EVENT_KINDS = Object.freeze([
  "concurrent-goals",
  "app-disconnect",
  "app-reconnect",
  "provider-rotation",
  "provider-unavailable",
  "control-plane-restart",
]);

export class SoakReportValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "SoakReportValidationError";
  }
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function sha256(value) {
  return createHash("sha256")
    .update(typeof value === "string" ? value : canonicalJson(value))
    .digest("hex");
}

function text(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new SoakReportValidationError(`${name} must be non-empty text`);
  return value.trim();
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new SoakReportValidationError(`${name} must be a positive safe integer`);
  return value;
}

function boundedNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)
    throw new SoakReportValidationError(`${name} must be a number in [0,1]`);
  return value;
}

function normalizedOptions(options = {}) {
  const fixtureId = text(options.fixtureId ?? DEFAULTS.fixtureId, "fixtureId");
  const candidateId = text(options.candidateId ?? DEFAULTS.candidateId, "candidateId");
  const durationMs = positiveInteger(options.durationMs ?? DEFAULTS.durationMs, "durationMs");
  const sampleIntervalMs = positiveInteger(options.sampleIntervalMs ?? DEFAULTS.sampleIntervalMs, "sampleIntervalMs");
  if (sampleIntervalMs > MAX_TIMER_MS) throw new SoakReportValidationError("sampleIntervalMs exceeds the Node timer limit");
  const goalCount = positiveInteger(options.goalCount ?? DEFAULTS.goalCount, "goalCount");
  const seed =
    Number.isSafeInteger(options.seed ?? DEFAULTS.seed) && (options.seed ?? DEFAULTS.seed) >= 0
      ? (options.seed ?? DEFAULTS.seed)
      : (() => {
          throw new SoakReportValidationError("seed must be a non-negative safe integer");
        })();
  const personaDriftBound = boundedNumber(options.personaDriftBound ?? DEFAULTS.personaDriftBound, "personaDriftBound");
  if (goalCount > 32) throw new SoakReportValidationError("goalCount must not exceed 32");
  // Include the logical endpoint so the report covers the configured window.
  // Reject configurations too short to contain the minimum eight samples instead
  // of silently extending the declared soak window.
  const minimumDurationMs = 7 * sampleIntervalMs;
  if (durationMs < minimumDurationMs)
    throw new SoakReportValidationError("durationMs must cover at least eight samples at sampleIntervalMs");
  const sampleCount = Math.max(8, Math.ceil(durationMs / sampleIntervalMs) + 1);
  if (sampleCount > MAX_SAMPLES) throw new SoakReportValidationError(`soak produces too many samples (maximum ${MAX_SAMPLES})`);
  const timelineOrigin = new Date(options.timelineOrigin ?? DEFAULTS.timelineOrigin);
  if (!Number.isFinite(timelineOrigin.getTime())) throw new SoakReportValidationError("timelineOrigin must be a valid datetime");
  return {
    fixtureId,
    candidateId,
    durationMs,
    sampleIntervalMs,
    goalCount,
    seed,
    personaDriftBound,
    sampleCount,
    timelineOrigin: timelineOrigin.toISOString(),
  };
}

function observedAt(origin, sampleIndex, intervalMs) {
  return new Date(new Date(origin).getTime() + sampleIndex * intervalMs).toISOString();
}

function event(kind, at, details = {}) {
  return { kind, at, ...details };
}

function makeGoals(goalCount, sampleIndex, seed) {
  return Array.from({ length: goalCount }, (_, goalIndex) => {
    const goalId = `fixture-goal-${goalIndex + 1}`;
    const headActive = (sampleIndex + seed) % 4 !== 3;
    const workerActive = (sampleIndex + seed) % 3 !== 1;
    return {
      goalId,
      state: "active",
      head: { active: headActive, ...(headActive ? { obligationId: `${goalId}:head-obligation` } : {}) },
      workers: [
        { workerId: `${goalId}:worker-1`, active: workerActive, ...(workerActive ? { obligationId: `${goalId}:worker-obligation` } : {}) },
      ],
    };
  });
}

function makeScopes(goalCount, origin, expirySample, intervalMs, sampleIndex) {
  const expiresAt = observedAt(origin, expirySample, intervalMs);
  const observed = observedAt(origin, sampleIndex, intervalMs);
  return Array.from({ length: goalCount }, (_, goalIndex) =>
    ["grant", "lease", "environment", "device"].map((kind) => ({
      id: `fixture-goal-${goalIndex + 1}:${kind}`,
      kind,
      expiresAt,
      active: observed < expiresAt,
    })),
  ).flat();
}

function makePersona(sampleIndex, bound, seed) {
  const delta = (((sampleIndex + seed + 7) % 5) - 2) * Math.min(0.02, bound / 4 || 0);
  return {
    roleId: "fixture-role-engineering",
    taskClass: "coding",
    adjustment: { initiative: delta },
    absoluteDrift: Math.abs(delta),
    declaredBound: bound,
  };
}

function assertSampleInvariants(sample, personaBound) {
  const violations = [];
  for (const goal of sample.goals) {
    if (goal.head.active && typeof goal.head.obligationId !== "string") violations.push(`${goal.goalId}:head-without-obligation`);
    for (const worker of goal.workers)
      if (worker.active && typeof worker.obligationId !== "string") violations.push(`${worker.workerId}:worker-without-obligation`);
  }
  const observedTime = Date.parse(sample.observedAt);
  if (!Number.isFinite(observedTime)) violations.push("sample:invalid-observed-at");
  for (const scope of sample.scopes) {
    const expiryTime = Date.parse(scope.expiresAt);
    if (!Number.isFinite(expiryTime)) violations.push(`${scope.id}:invalid-expiry`);
    else if (scope.active !== observedTime < expiryTime) violations.push(`${scope.id}:scope-outside-expiry`);
  }
  if (sample.persona.absoluteDrift > personaBound) violations.push("persona:drift-bound");
  return violations;
}

function reportWithoutHash(report) {
  const withoutHash = { ...report };
  delete withoutHash.contentHash;
  return withoutHash;
}

function validateSampleShape(sample, goalCount, personaBound) {
  if (
    !sample ||
    typeof sample !== "object" ||
    typeof sample.observedAt !== "string" ||
    !Array.isArray(sample.goals) ||
    sample.goals.length !== goalCount ||
    !Array.isArray(sample.scopes) ||
    sample.scopes.length !== goalCount * 4
  )
    throw new SoakReportValidationError("soak sample is incomplete");
  for (const [goalIndex, goal] of sample.goals.entries()) {
    if (
      !goal ||
      typeof goal !== "object" ||
      goal.goalId !== `fixture-goal-${goalIndex + 1}` ||
      !goal.head ||
      typeof goal.head !== "object" ||
      typeof goal.head.active !== "boolean" ||
      !Array.isArray(goal.workers) ||
      goal.workers.length !== 1
    )
      throw new SoakReportValidationError("soak goal obligation projection is malformed");
    const worker = goal.workers[0];
    if (
      !worker ||
      typeof worker !== "object" ||
      worker.workerId !== `fixture-goal-${goalIndex + 1}:worker-1` ||
      typeof worker.active !== "boolean"
    )
      throw new SoakReportValidationError("soak worker obligation projection is malformed");
    if (goal.head.active && (typeof goal.head.obligationId !== "string" || goal.head.obligationId.trim() === ""))
      throw new SoakReportValidationError("active Head must have an obligation");
    if (worker.active && (typeof worker.obligationId !== "string" || worker.obligationId.trim() === ""))
      throw new SoakReportValidationError("active worker must have an obligation");
  }
  const scopeKinds = ["grant", "lease", "environment", "device"];
  for (const [scopeIndex, scope] of sample.scopes.entries()) {
    const expectedScopeKind = scopeKinds[scopeIndex % scopeKinds.length];
    if (
      !scope ||
      typeof scope !== "object" ||
      scope.kind !== expectedScopeKind ||
      scope.id !== `fixture-goal-${Math.floor(scopeIndex / 4) + 1}:${expectedScopeKind}` ||
      typeof scope.id !== "string" ||
      typeof scope.expiresAt !== "string" ||
      typeof scope.active !== "boolean"
    )
      throw new SoakReportValidationError("soak scope projection is malformed");
  }
  if (
    !sample.provider ||
    typeof sample.provider !== "object" ||
    !["fixture/provider-a", "fixture/provider-b"].includes(sample.provider.selectedModelRef) ||
    sample.provider.actualModelRef !== null ||
    typeof sample.provider.available !== "boolean" ||
    !sample.app ||
    typeof sample.app.connected !== "boolean" ||
    !sample.controlPlane ||
    typeof sample.controlPlane.generation !== "number" ||
    ![1, 2].includes(sample.controlPlane.generation) ||
    !sample.discord ||
    sample.discord.probeStatus !== "synthetic-ok" ||
    !sample.persona ||
    typeof sample.persona !== "object" ||
    sample.persona.roleId !== "fixture-role-engineering" ||
    sample.persona.taskClass !== "coding" ||
    !sample.persona.adjustment ||
    typeof sample.persona.adjustment !== "object" ||
    typeof sample.persona.adjustment.initiative !== "number" ||
    Math.abs(sample.persona.adjustment.initiative) !== sample.persona.absoluteDrift ||
    typeof sample.persona.declaredBound !== "number" ||
    sample.persona.declaredBound !== personaBound ||
    typeof sample.persona.absoluteDrift !== "number" ||
    !Number.isFinite(sample.persona.absoluteDrift) ||
    sample.persona.absoluteDrift < 0 ||
    sample.persona.absoluteDrift > personaBound
  )
    throw new SoakReportValidationError("soak persona projection is malformed");
}

export function validateSoakReport(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SoakReportValidationError("soak report must be an object");
  const report = value;
  if (report.schemaVersion !== SOAK_REPORT_SCHEMA_VERSION) throw new SoakReportValidationError("unsupported soak report schema version");
  if (report.status !== "completed") throw new SoakReportValidationError("soak report is not completed");
  if (report.mode !== "disposable-fixture") throw new SoakReportValidationError("soak report mode must identify the disposable fixture");
  if (!report.fixture || typeof report.fixture !== "object" || Array.isArray(report.fixture))
    throw new SoakReportValidationError("soak fixture identity is required");
  text(report.fixture.id, "fixture.id");
  text(report.fixture.candidateId, "fixture.candidateId");
  positiveInteger(report.fixture.goalCount, "fixture.goalCount");
  if (!Number.isSafeInteger(report.fixture.seed) || report.fixture.seed < 0)
    throw new SoakReportValidationError("fixture.seed must be a non-negative safe integer");
  text(report.fixture.timelineOrigin, "fixture.timelineOrigin");
  if (!Number.isFinite(Date.parse(report.fixture.timelineOrigin)))
    throw new SoakReportValidationError("fixture.timelineOrigin must be a valid datetime");
  if (!report.configuration || typeof report.configuration !== "object" || Array.isArray(report.configuration))
    throw new SoakReportValidationError("soak configuration is required");
  positiveInteger(report.configuration.durationMs, "configuration.durationMs");
  positiveInteger(report.configuration.sampleIntervalMs, "configuration.sampleIntervalMs");
  if (report.configuration.sampleIntervalMs > MAX_TIMER_MS)
    throw new SoakReportValidationError("configuration sample interval exceeds the Node timer limit");
  if (report.configuration.durationMs < 7 * report.configuration.sampleIntervalMs)
    throw new SoakReportValidationError("configuration duration does not cover eight samples");
  const expectedSampleCount = Math.max(8, Math.ceil(report.configuration.durationMs / report.configuration.sampleIntervalMs) + 1);
  if (report.configuration.sampleCount !== expectedSampleCount)
    throw new SoakReportValidationError("configuration.sampleCount is not reproducible");
  if (report.fixture.goalCount > 32) throw new SoakReportValidationError("fixture.goalCount must not exceed 32");
  if (!report.persona || typeof report.persona !== "object" || Array.isArray(report.persona))
    throw new SoakReportValidationError("persona evidence is required");
  text(report.persona.roleId, "persona.roleId");
  text(report.persona.taskClass, "persona.taskClass");
  if (report.persona.roleId !== "fixture-role-engineering" || report.persona.taskClass !== "coding")
    throw new SoakReportValidationError("persona identity does not match the fixture");
  boundedNumber(report.persona.declaredBound, "persona.declaredBound");
  if (!Array.isArray(report.persona.samples)) throw new SoakReportValidationError("persona samples are required");
  if (!Array.isArray(report.samples) || report.samples.length < 8)
    throw new SoakReportValidationError("soak report requires at least eight samples");
  if (report.configuration.sampleCount !== report.samples.length)
    throw new SoakReportValidationError("configuration.sampleCount does not match samples");
  if (!Array.isArray(report.events)) throw new SoakReportValidationError("soak report events are required");
  if (report.events.some((eventRecord) => !eventRecord || typeof eventRecord !== "object" || !SOAK_EVENT_KINDS.includes(eventRecord.kind)))
    throw new SoakReportValidationError("soak report contains an unknown event kind");
  for (const kind of SOAK_ONE_OFF_EVENT_KINDS) {
    if (report.events.filter((eventRecord) => eventRecord.kind === kind).length !== 1)
      throw new SoakReportValidationError(`${kind} must occur exactly once`);
  }
  for (const kind of ["idle-evaluation", "discord-probe", "persona-evidence", "resource-cost-storage-sample"]) {
    if (report.events.filter((eventRecord) => eventRecord?.kind === kind).length !== report.samples.length)
      throw new SoakReportValidationError(`${kind} does not cover the full soak window`);
  }
  if (
    !report.coverage ||
    !Array.isArray(report.coverage.contents) ||
    report.coverage.sampleCount !== report.samples.length ||
    canonicalJson(report.coverage.contents) !== canonicalJson(REQUIRED_SOAK_CONTENTS)
  )
    throw new SoakReportValidationError("soak report contents are incomplete");
  if (!report.assertions || !Array.isArray(report.assertions.violations) || report.assertions.violations.length !== 0)
    throw new SoakReportValidationError("soak report contains invariant violations");
  const providerBoundary = report.boundaries?.provider;
  const discordBoundary = report.boundaries?.discord;
  const controlPlaneBoundary = report.boundaries?.controlPlane;
  if (
    !providerBoundary ||
    providerBoundary.mode !== "fake-loopback" ||
    providerBoundary.live !== false ||
    providerBoundary.calls !== 0 ||
    !Number.isSafeInteger(providerBoundary.controlledUnavailableSamples) ||
    providerBoundary.controlledUnavailableSamples < 1 ||
    !discordBoundary ||
    discordBoundary.mode !== "synthetic-test-observation" ||
    discordBoundary.live !== false ||
    !controlPlaneBoundary ||
    controlPlaneBoundary.mode !== "generation-fixture" ||
    controlPlaneBoundary.live !== false
  )
    throw new SoakReportValidationError("live provider, Discord, and control-plane boundaries must be explicit");
  if (report.persona.samples.length !== report.samples.length)
    throw new SoakReportValidationError("persona samples do not cover the full soak window");
  const expectedScopeExpiry = observedAt(
    report.fixture.timelineOrigin,
    Math.max(3, Math.floor(report.samples.length / 2)),
    report.configuration.sampleIntervalMs,
  );
  for (const [index, sample] of report.samples.entries()) {
    const expectedObservedAt = observedAt(report.fixture.timelineOrigin, index, report.configuration.sampleIntervalMs);
    if (sample.sampleIndex !== index || sample.observedAt !== expectedObservedAt)
      throw new SoakReportValidationError("soak samples do not cover the recorded timeline");
    validateSampleShape(sample, report.fixture.goalCount, report.persona.declaredBound);
    if (sample.scopes.some((scope) => scope.expiresAt !== expectedScopeExpiry))
      throw new SoakReportValidationError("soak scope expiry does not match the recorded fixture window");
    if (canonicalJson(report.persona.samples[index]) !== canonicalJson(sample.persona))
      throw new SoakReportValidationError("persona evidence sample does not match the sampled projection");
    if (canonicalJson(sample.goals) !== canonicalJson(makeGoals(report.fixture.goalCount, index, report.fixture.seed)))
      throw new SoakReportValidationError("soak goal projection does not match the fixture identity");
    if (
      canonicalJson(sample.scopes) !==
      canonicalJson(
        makeScopes(
          report.fixture.goalCount,
          report.fixture.timelineOrigin,
          Math.max(3, Math.floor(report.samples.length / 2)),
          report.configuration.sampleIntervalMs,
          index,
        ),
      )
    )
      throw new SoakReportValidationError("soak scope projection does not match the fixture identity");
    const expectedPersona = makePersona(index, report.persona.declaredBound, report.fixture.seed);
    if (canonicalJson(sample.persona) !== canonicalJson(expectedPersona))
      throw new SoakReportValidationError("soak persona projection does not match the fixture identity");
    const expectedProvider = {
      selectedModelRef: index % 2 === 0 ? "fixture/provider-a" : "fixture/provider-b",
      actualModelRef: null,
      available: index === 2 || (index + report.fixture.seed) % 11 === 0 ? false : true,
    };
    if (canonicalJson(sample.provider) !== canonicalJson(expectedProvider))
      throw new SoakReportValidationError("soak provider projection does not match the fixture identity");
    if (
      sample.app.connected !== (index % 4 !== 1) ||
      sample.controlPlane.generation !== (index >= Math.floor(report.samples.length / 2) ? 2 : 1)
    )
      throw new SoakReportValidationError("soak restart or reconnect projection does not match the fixture identity");
    const violations = assertSampleInvariants(sample, report.persona.declaredBound);
    if (violations.length > 0) throw new SoakReportValidationError(`soak sample invariant failed: ${violations.join(",")}`);
  }
  if (
    report.assertions.idleObligationSamples !== report.samples.length ||
    report.assertions.scopeSamples !== report.samples.length ||
    report.assertions.personaBoundSamples !== report.samples.length
  )
    throw new SoakReportValidationError("soak report assertion counts do not cover every sample");
  if (!Array.isArray(report.assertions.scopeLeaks) || report.assertions.scopeLeaks.length !== 0)
    throw new SoakReportValidationError("soak report contains scope leaks");
  const expectedMaxDrift = Math.max(...report.samples.map((sample) => sample.persona.absoluteDrift));
  if (report.persona.maxAbsoluteDrift !== expectedMaxDrift) throw new SoakReportValidationError("persona max drift does not match samples");
  if (
    discordBoundary.probes !== report.samples.length ||
    providerBoundary.controlledUnavailableSamples !== report.samples.filter((sample) => !sample.provider.available).length
  )
    throw new SoakReportValidationError("provider and Discord boundary counts do not match samples");
  const sampleTimes = new Set(report.samples.map((sample) => sample.observedAt));
  const sampleEvent = (kind, sampleIndex, predicate = () => true) => {
    const at = report.samples[sampleIndex].observedAt;
    const matching = report.events.filter((eventRecord) => eventRecord?.kind === kind && eventRecord.at === at && predicate(eventRecord));
    if (matching.length !== 1) throw new SoakReportValidationError(`${kind} does not map one-to-one to sample ${sampleIndex}`);
  };
  for (const [sampleIndex, sample] of report.samples.entries()) {
    sampleEvent("idle-evaluation", sampleIndex, (eventRecord) => eventRecord.scheduled === true);
    sampleEvent("discord-probe", sampleIndex, (eventRecord) => eventRecord.status === sample.discord.probeStatus);
    sampleEvent(
      "persona-evidence",
      sampleIndex,
      (eventRecord) => eventRecord.roleId === sample.persona.roleId && eventRecord.taskClass === sample.persona.taskClass,
    );
    sampleEvent("resource-cost-storage-sample", sampleIndex);
  }
  const eventAt = (kind, at, predicate = () => true) => {
    const matching = report.events.find((eventRecord) => eventRecord?.kind === kind && eventRecord.at === at && predicate(eventRecord));
    if (matching === undefined) throw new SoakReportValidationError(`${kind} event is missing or outside the sampled timeline`);
  };
  const firstAt = report.samples[0].observedAt;
  const disconnectAt = report.samples[1].observedAt;
  const reconnectAt = report.samples[2].observedAt;
  const restartAt = report.samples[Math.floor(report.samples.length / 2)].observedAt;
  if (!sampleTimes.has(firstAt) || !sampleTimes.has(disconnectAt) || !sampleTimes.has(reconnectAt) || !sampleTimes.has(restartAt))
    throw new SoakReportValidationError("soak event timeline is incomplete");
  eventAt("concurrent-goals", firstAt, (eventRecord) => eventRecord.goalCount === report.fixture.goalCount);
  eventAt("app-disconnect", disconnectAt);
  eventAt("app-reconnect", reconnectAt);
  eventAt(
    "provider-rotation",
    disconnectAt,
    (eventRecord) => eventRecord.from === "fixture/provider-a" && eventRecord.to === "fixture/provider-b",
  );
  eventAt(
    "provider-unavailable",
    reconnectAt,
    (eventRecord) => eventRecord.modelRef === "fixture/provider-a" && eventRecord.controlled === true,
  );
  eventAt("control-plane-restart", restartAt, (eventRecord) => eventRecord.generation === 2 && eventRecord.processRestarted === false);
  if (typeof report.observationDigest !== "string" || sha256(report.samples) !== report.observationDigest)
    throw new SoakReportValidationError("soak observation digest does not match samples");
  if (typeof report.contentHash !== "string" || sha256(reportWithoutHash(report)) !== report.contentHash)
    throw new SoakReportValidationError("soak report content hash does not match report");
  return report;
}

async function acquireReportLock(lockPath, absolutePath) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`, "utf8");
        return handle;
      } catch (error) {
        await handle.close().catch(() => {});
        await unlink(lockPath).catch(() => {});
        throw error;
      }
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let owner;
      try {
        owner = JSON.parse(await readFile(lockPath, "utf8"));
      } catch {
        throw new Error(`Soak report lock is stale or unreadable; confirm no runner is active, then remove ${lockPath}`);
      }
      if (!Number.isSafeInteger(owner?.pid) || owner.pid <= 0)
        throw new Error(`Soak report lock is stale or unreadable; confirm no runner is active, then remove ${lockPath}`);
      try {
        process.kill(owner.pid, 0);
        throw new Error(`Soak report is already being written: ${absolutePath}`);
      } catch (probeError) {
        if (probeError?.code !== "ESRCH") throw probeError;
        await unlink(lockPath).catch(() => {});
      }
    }
  }
  throw new Error(`Soak report is already being written: ${absolutePath}`);
}

async function writeDurableReport(report, reportPath, force = false) {
  const absolutePath = resolve(reportPath);
  const lockPath = `${absolutePath}.lock`;
  await mkdir(dirname(absolutePath), { recursive: true, mode: 0o700 });
  let lockHandle;
  let lockAcquired = false;
  let temporaryPath;
  try {
    lockHandle = await acquireReportLock(lockPath, absolutePath);
    lockAcquired = true;
    try {
      await stat(absolutePath);
      if (!force) throw new Error(`Refusing to overwrite existing soak report: ${absolutePath}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    temporaryPath = `${absolutePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, absolutePath);
    temporaryPath = undefined;
    await chmod(absolutePath, 0o600);
  } finally {
    if (temporaryPath !== undefined) await unlink(temporaryPath).catch(() => {});
    if (lockHandle !== undefined) await lockHandle.close().catch(() => {});
    if (lockAcquired) await unlink(lockPath).catch(() => {});
  }
  return absolutePath;
}

export async function runSoak(options = {}) {
  const config = normalizedOptions(options);
  const expirySample = Math.max(3, Math.floor(config.sampleCount / 2));
  const samples = [];
  for (let sampleIndex = 0; sampleIndex < config.sampleCount; sampleIndex += 1) {
    const at = observedAt(config.timelineOrigin, sampleIndex, config.sampleIntervalMs);
    const persona = makePersona(sampleIndex, config.personaDriftBound, config.seed);
    samples.push({
      sampleIndex,
      observedAt: at,
      goals: makeGoals(config.goalCount, sampleIndex, config.seed),
      scopes: makeScopes(config.goalCount, config.timelineOrigin, expirySample, config.sampleIntervalMs, sampleIndex),
      app: { connected: sampleIndex % 4 !== 1 },
      provider: {
        selectedModelRef: sampleIndex % 2 === 0 ? "fixture/provider-a" : "fixture/provider-b",
        actualModelRef: null,
        available: sampleIndex === 2 || (sampleIndex + config.seed) % 11 === 0 ? false : true,
      },
      controlPlane: { generation: sampleIndex >= Math.floor(config.sampleCount / 2) ? 2 : 1 },
      discord: { probeStatus: "synthetic-ok" },
      persona,
      metrics: { resourceUnits: config.goalCount + 1, costCents: sampleIndex, storageBytes: 4_096 + sampleIndex * 256 },
    });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, config.sampleIntervalMs));
  }
  const violations = samples.flatMap((sample) => assertSampleInvariants(sample, config.personaDriftBound));
  const maxAbsoluteDrift = Math.max(...samples.map((sample) => sample.persona.absoluteDrift));
  const first = samples[0];
  const events = [
    event("concurrent-goals", first.observedAt, { goalCount: config.goalCount }),
    event("app-disconnect", samples[1].observedAt),
    event("app-reconnect", samples[2].observedAt),
    event("provider-rotation", samples[1].observedAt, { from: "fixture/provider-a", to: "fixture/provider-b" }),
    event("provider-unavailable", samples[2].observedAt, { modelRef: "fixture/provider-a", controlled: true }),
    event("control-plane-restart", samples[Math.floor(config.sampleCount / 2)].observedAt, { generation: 2, processRestarted: false }),
    ...samples.flatMap((sample) => [
      event("idle-evaluation", sample.observedAt, { scheduled: true }),
      event("discord-probe", sample.observedAt, { status: sample.discord.probeStatus }),
      event("persona-evidence", sample.observedAt, { roleId: sample.persona.roleId, taskClass: sample.persona.taskClass }),
      event("resource-cost-storage-sample", sample.observedAt),
    ]),
  ];
  const report = {
    schemaVersion: SOAK_REPORT_SCHEMA_VERSION,
    status: "completed",
    mode: "disposable-fixture",
    fixture: {
      id: config.fixtureId,
      candidateId: config.candidateId,
      seed: config.seed,
      goalCount: config.goalCount,
      timelineOrigin: config.timelineOrigin,
    },
    configuration: { durationMs: config.durationMs, sampleIntervalMs: config.sampleIntervalMs, sampleCount: config.sampleCount },
    coverage: { contents: [...REQUIRED_SOAK_CONTENTS], sampleCount: samples.length },
    boundaries: {
      provider: {
        mode: "fake-loopback",
        live: false,
        calls: 0,
        controlledUnavailableSamples: samples.filter((sample) => !sample.provider.available).length,
      },
      discord: { mode: "synthetic-test-observation", live: false, probes: samples.length },
      controlPlane: { mode: "generation-fixture", live: false },
    },
    events,
    samples,
    persona: {
      roleId: "fixture-role-engineering",
      taskClass: "coding",
      declaredBound: config.personaDriftBound,
      maxAbsoluteDrift,
      samples: samples.map((sample) => sample.persona),
    },
    assertions: {
      violations,
      idleObligationSamples: samples.length,
      scopeSamples: samples.length,
      scopeLeaks: [],
      personaBoundSamples: samples.filter((sample) => sample.persona.absoluteDrift <= config.personaDriftBound).length,
    },
    limitations: [
      "Provider rotation and unavailability use a deterministic fake-loopback fixture; no live provider was called.",
      "Discord probes are synthetic observations; no live Discord detector or delivery was exercised.",
      "Control-plane restart is represented by a fixture generation transition; no process restart is claimed.",
    ],
  };
  report.observationDigest = sha256(report.samples);
  report.contentHash = sha256(reportWithoutHash(report));
  validateSoakReport(report);
  if (options.reportPath !== undefined) await writeDurableReport(report, options.reportPath, options.force === true);
  return report;
}

export async function replaySoakReport(report) {
  const valid = validateSoakReport(report);
  const replay = await runSoak({
    fixtureId: valid.fixture.id,
    candidateId: valid.fixture.candidateId,
    seed: valid.fixture.seed,
    goalCount: valid.fixture.goalCount,
    timelineOrigin: valid.fixture.timelineOrigin,
    durationMs: valid.configuration.durationMs,
    sampleIntervalMs: valid.configuration.sampleIntervalMs,
    personaDriftBound: valid.persona.declaredBound,
  });
  if (replay.observationDigest !== valid.observationDigest || replay.contentHash !== valid.contentHash)
    throw new SoakReportValidationError("soak report cannot be reproduced from its fixture identity");
  return replay;
}

function cliArgs() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      duration: { type: "string" },
      "sample-interval": { type: "string" },
      "goal-count": { type: "string" },
      "fixture-id": { type: "string" },
      "candidate-id": { type: "string" },
      seed: { type: "string" },
      "timeline-origin": { type: "string" },
      "persona-drift-bound": { type: "string" },
      report: { type: "string" },
      force: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(
      "Usage: node scripts/run-soak.mjs --report <path> [--duration <ms>] [--sample-interval <ms>] [--goal-count <n>] [--fixture-id <id>] [--candidate-id <id>] [--seed <n>] [--timeline-origin <ISO>] [--persona-drift-bound <0..1>] [--force]",
    );
    return undefined;
  }
  if (values.report === undefined) throw new Error("--report is required for a durable soak report");
  const number = (value, name) => {
    if (value === undefined) return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`${name} must be numeric`);
    return parsed;
  };
  return {
    durationMs: number(values.duration, "--duration"),
    sampleIntervalMs: number(values["sample-interval"], "--sample-interval"),
    goalCount: number(values["goal-count"], "--goal-count"),
    fixtureId: values["fixture-id"],
    candidateId: values["candidate-id"],
    seed: number(values.seed, "--seed"),
    timelineOrigin: values["timeline-origin"],
    personaDriftBound: number(values["persona-drift-bound"], "--persona-drift-bound"),
    reportPath: values.report,
    force: values.force,
  };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = cliArgs();
    if (options !== undefined) {
      const report = await runSoak(options);
      console.log(
        JSON.stringify({
          status: report.status,
          reportPath: resolve(options.reportPath),
          contentHash: report.contentHash,
          samples: report.samples.length,
        }),
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Soak runner failed");
    process.exitCode = 1;
  }
}
