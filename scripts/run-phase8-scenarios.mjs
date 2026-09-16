import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, open, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { REQUIRED_CHECKPOINT_ID, REPRESENTATIVE_SCENARIOS, validateScenarioReport } from "../test/phase8-scenarios/scenario-catalog.mjs";

const SCHEMA_VERSION = 1;
const DEFAULT_CANDIDATE_ID = "phase8-s9-disposable-candidate-v1";
const DEFAULT_REPORT_PATH = "/tmp/plan8-s9-scenarios.json";

function parseArgs(argv) {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg?.startsWith("--") !== true) throw new Error(`unexpected argument: ${arg}`);
    if (arg === "--execute" || arg === "--force") flags.add(arg.slice(2));
    else {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      values.set(arg.slice(2), value);
      index += 1;
    }
  }
  return { values, flags };
}

function hashReport(report) {
  return createHash("sha256").update(JSON.stringify(report)).digest("hex");
}

function emptyRecord(scenario, status, live, limitation) {
  const actual = { actors: [], models: [], skills: [], tools: [], costs: null };
  return {
    scenarioId: scenario.id,
    fixtureId: scenario.fixtureId,
    status,
    live,
    actors: [],
    models: [],
    skills: [],
    tools: [],
    costs: null,
    actual,
    injectedFailures: [],
    durableEvents: [],
    durableEvidence: [],
    preconditions: scenario.preconditions,
    goalId: null,
    taskContractVersion: null,
    expectedBehavior: scenario.expectedBehavior,
    observedBehavior: null,
    certifications: [],
    dissent: [],
    limitations: [limitation, ...scenario.limitations],
    cleanup: scenario.cleanup,
  };
}

export function createBlockedScenarioReport(candidateId = DEFAULT_CANDIDATE_ID, reason = "live acceptance is pending") {
  const report = {
    schemaVersion: SCHEMA_VERSION,
    candidateId,
    checkpointId: REQUIRED_CHECKPOINT_ID,
    status: "blocked",
    mode: "inventory-only",
    scenarios: REPRESENTATIVE_SCENARIOS.map((scenario) => emptyRecord(scenario, "blocked", false, reason)),
    limitations: [
      reason,
      "This report does not claim a complete eleven-scenario live run.",
      "Provider, remote, deployment, payment, Discord, and external-send effects remain disabled.",
    ],
  };
  validateScenarioReport(report);
  return { ...report, contentHash: hashReport(report) };
}

function runCommand(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], cwd: process.cwd(), env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code, signal) => resolvePromise({ code, signal, stdout, stderr }));
  });
}

async function writeReportAtomic(reportPath, report, force) {
  const destination = resolve(reportPath);
  const lockPath = `${destination}.lock`;
  const temporaryPath = `${destination}.tmp-${process.pid}`;
  await mkdir(dirname(destination), { recursive: true });
  let lock;
  let ownsLock = false;
  try {
    lock = await open(lockPath, "wx", 0o600);
    ownsLock = true;
    await lock.writeFile(JSON.stringify({ pid: process.pid, reportPath: destination }));
    await lock.close();
    lock = undefined;
    if (!force) {
      try {
        await lstat(destination);
        throw new Error(`refusing to overwrite existing report: ${destination}`);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, destination);
    return destination;
  } finally {
    if (lock !== undefined) await lock.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    if (ownsLock) await unlink(lockPath).catch(() => undefined);
  }
}

export async function runScenarioBundle({
  candidateId = DEFAULT_CANDIDATE_ID,
  reportPath = DEFAULT_REPORT_PATH,
  execute = false,
  force = false,
} = {}) {
  if (!execute || process.env.MAESTRO_PHASE8_SCENARIOS_LIVE !== "1") {
    const report = createBlockedScenarioReport(candidateId);
    const writtenPath = await writeReportAtomic(reportPath, report, force);
    return { report, reportPath: writtenPath, exitCode: 2 };
  }

  const targets = [...new Set(REPRESENTATIVE_SCENARIOS.flatMap((scenario) => scenario.executable.targets))];
  const result = await runCommand(process.execPath, ["node_modules/vitest/vitest.mjs", "run", ...targets]);
  const suiteSummary = `single continuous suite exit=${result.code ?? "null"} signal=${result.signal ?? "none"}`;
  const report = {
    schemaVersion: SCHEMA_VERSION,
    candidateId,
    checkpointId: REQUIRED_CHECKPOINT_ID,
    status: "blocked",
    mode: "suite-observation-incomplete",
    scenarios: REPRESENTATIVE_SCENARIOS.map((scenario) => {
      const record = emptyRecord(scenario, "blocked", false, "full scenario evidence mapping is not available from suite output");
      return {
        ...record,
        durableEvidence: [suiteSummary],
        observedBehavior:
          result.code === 0
            ? "mapped suites passed, but the required full-system record is unavailable"
            : `mapped suites exited ${result.code ?? "null"}`,
      };
    }),
    limitations: [
      "The mapped suites were executed once, but their output is not a complete full-system scenario record.",
      "No live acceptance is claimed from this runner until actors, models, skills, tools, costs, durable events, certifications, dissent, and cleanup are captured from the same run.",
      "Provider, remote, deployment, payment, Discord, and external-send effects remain disabled.",
    ],
  };
  validateScenarioReport(report);
  const withHash = { ...report, contentHash: hashReport(report) };
  const writtenPath = await writeReportAtomic(reportPath, withHash, force);
  return {
    report: withHash,
    reportPath: writtenPath,
    exitCode: 2,
    suiteExitCode: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const { values, flags } = parseArgs(process.argv.slice(2));
    const result = await runScenarioBundle({
      candidateId: values.get("candidate") ?? DEFAULT_CANDIDATE_ID,
      reportPath: values.get("report") ?? DEFAULT_REPORT_PATH,
      execute: flags.has("execute"),
      force: flags.has("force"),
    });
    process.stdout.write(
      `${JSON.stringify({ status: result.report.status, mode: result.report.mode, reportPath: result.reportPath, contentHash: result.report.contentHash, scenarios: result.report.scenarios.length })}\n`,
    );
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
