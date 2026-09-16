#!/usr/bin/env node
import { createHash } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawn } from "node:child_process";

export const REQUIRED_ROLLBACK_RERUNS = Object.freeze(["failed scenario", "phase gate", "full regression gate"]);

function object(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value;
}
function text(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} must be non-empty text`);
  return value.trim();
}
async function readJson(path, name) {
  try { return JSON.parse(await readFile(resolve(path), "utf8")); }
  catch (error) { throw new Error(`Could not read ${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
async function writeJson(path, value) {
  const destination = resolve(path);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, destination);
  await chmod(destination, 0o600);
  return destination;
}
function digest(value) { return createHash("sha256").update(value).digest("hex"); }
function commandResult(command, args, result) {
  return { name: command.name, command: command.command, args: command.args, exitCode: result.code ?? null, signal: result.signal ?? null, timedOut: result.timedOut === true, stdoutSha256: digest(result.stdout), stderrSha256: digest(result.stderr) };
}
function effectDisabledEnvironment() {
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY|API_KEY)/i.test(key)));
  return { ...environment, MAESTRO_EXTERNAL_EFFECTS: "disabled", MAESTRO_IMPROVEMENT_AUTHORITY: "disabled", MAESTRO_RELEASE_ROLLBACK: "1" };
}
function runCommand(command, timeoutMs) {
  return new Promise((resolvePromise) => {
    const child = spawn(command.command, command.args, { cwd: command.cwd ?? process.cwd(), env: effectDisabledEnvironment(), shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = ""; let settled = false; let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      const terminate = (signal) => { try { if (child.pid !== undefined && process.platform !== "win32") process.kill(-child.pid, signal); else child.kill(signal); } catch { /* process already exited */ } };
      terminate("SIGTERM");
      setTimeout(() => { if (!settled) terminate("SIGKILL"); }, 100).unref();
    }, timeoutMs);
    const finish = (result) => { if (settled) return; settled = true; clearTimeout(timer); resolvePromise({ ...result, stdout, stderr, timedOut }); };
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => finish({ code: null, signal: null, stderr: error.message }));
    child.once("close", (code, signal) => finish({ code, signal }));
  });
}
async function preserve(source, destination) {
  await copyFile(resolve(source), resolve(destination), constants.COPYFILE_EXCL);
  await chmod(resolve(destination), 0o600);
  return resolve(destination);
}
function safeSegment(value, name) {
  const normalized = text(value, name);
  if (!/^[A-Za-z0-9_-]+$/.test(normalized) || normalized === "." || normalized === "..") throw new Error(`${name} must be a safe path segment`);
  return normalized;
}
function confinedPath(root, path, name) {
  const resolved = resolve(path);
  const remainder = relative(resolve(root), resolved);
  if (remainder === "" || remainder === ".." || remainder.startsWith(`..${requireSeparator()}`) || remainder.startsWith(requireSeparator())) throw new Error(`${name} must remain inside the rollback directory`);
  return resolved;
}
function requireSeparator() { return process.platform === "win32" ? "\\" : "/"; }
async function assertRegularFile(path, name) {
  const info = await lstat(resolve(path));
  if (!info.isFile()) throw new Error(`${name} must be a regular file`);
}
function approvedRerun(rerun, disposableFixture) {
  if (disposableFixture !== true) return false;
  const fixtureScript = resolve("test/phase8-release/approved-rerun.mjs");
  return resolve(rerun.command) === resolve(process.execPath) && JSON.stringify(rerun.args) === JSON.stringify([fixtureScript, rerun.name]);
}
function missingOptions(options) {
  return ["statePath", "evidencePath", "candidatePath", "failurePath"].filter((name) => typeof options[name] !== "string" || options[name].trim() === "");
}

export async function runRollback(options = {}) {
  const missing = missingOptions(options);
  if (missing.length > 0) return { status: "blocked", blockers: [`rollback inputs are unavailable: ${missing.join(", ")}`], reruns: [] };
  let state; let evidence; let candidate; let failure;
  try {
    [state, evidence, candidate, failure] = await Promise.all([
      readJson(options.statePath, "rollback state"), readJson(options.evidencePath, "failure evidence"), readJson(options.candidatePath, "candidate version"), readJson(options.failurePath, "failed scenario"),
    ]);
  } catch (error) {
    return { status: "blocked", blockers: [error instanceof Error ? error.message : String(error)], reruns: [] };
  }
  try {
    object(state, "rollback state"); object(evidence, "failure evidence"); object(candidate, "candidate version");
    const failureRecord = object(failure, "failed scenario");
    if (failureRecord.status !== "failed") throw new Error("rollback requires a failed scenario record");
    const candidateId = safeSegment(candidate.candidateId ?? state.candidateId, "candidateId");
    if (state.candidateId !== candidateId) throw new Error("candidate identity does not match rollback state");
    if (!Array.isArray(state.activeGoals)) throw new Error("rollback state must list active test Goals");
    if (!Array.isArray(options.reruns) || options.reruns.length !== REQUIRED_ROLLBACK_RERUNS.length) throw new Error("rollback requires failed scenario, phase gate, and full regression reruns");
    const names = options.reruns.map((rerun) => text(rerun?.name, "rerun.name"));
    for (const required of REQUIRED_ROLLBACK_RERUNS) if (!names.includes(required)) throw new Error(`rollback rerun is missing: ${required}`);
    const timeoutMs = options.timeoutMs ?? 60_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300_000) throw new Error("timeoutMs must be between 1 and 300000 milliseconds");
    for (const rerun of options.reruns) {
      object(rerun, "rerun"); text(rerun.command, "rerun.command");
      if (!Array.isArray(rerun.args) || rerun.args.some((arg) => typeof arg !== "string")) throw new Error("rerun.args must be a string array");
      if (rerun.cwd !== undefined && resolve(rerun.cwd) !== resolve(process.cwd())) throw new Error("rerun cwd must be the repository directory");
      if (!approvedRerun(rerun, options.disposableFixture)) throw new Error(`rerun command is not approved: ${rerun.name}`);
    }
    const rollbackRoot = dirname(resolve(options.statePath));
    const requestedPreservedDir = confinedPath(rollbackRoot, options.preservedDir ?? joinFallback(options.statePath, candidateId), "preservedDir");
    await mkdir(requestedPreservedDir, { recursive: true, mode: 0o700 });
    const preservedDir = confinedPath(await realpath(rollbackRoot), await realpath(requestedPreservedDir), "preservedDir");
    await Promise.all([[options.candidatePath, "candidate"], [options.evidencePath, "evidence"], [options.failurePath, "failure"]].map(([path, name]) => assertRegularFile(path, name)));
    await mkdir(preservedDir, { recursive: true, mode: 0o700 });
    const preserved = {
      candidate: await preserve(options.candidatePath, `${preservedDir}/candidate.json`),
      evidence: await preserve(options.evidencePath, `${preservedDir}/evidence.json`),
      failure: await preserve(options.failurePath, `${preservedDir}/failure.json`),
    };
    const nextState = {
      ...state,
      releaseProgression: "stopped",
      externalAuthority: "disabled",
      improvementAuthority: "disabled",
      activeGoals: state.activeGoals.map((goal) => ({ ...object(goal, "active Goal"), state: ["active", "running", "ready"].includes(goal.state) ? "paused" : goal.state })),
      rollback: { candidateId, failedScenarioId: text(failureRecord.scenarioId, "failure.scenarioId"), phaseGate: text(failureRecord.phaseGate, "failure.phaseGate"), preservedDir },
    };
    await writeJson(options.statePath, nextState);
    const reruns = [];
    for (const rerun of options.reruns) reruns.push(commandResult(rerun, rerun.args, await runCommand({ ...rerun, args: rerun.args }, timeoutMs)));
    const report = { schemaVersion: 1, status: reruns.every((run) => run.exitCode === 0) ? "rolled_back" : "rollback_reruns_failed", candidateId, failedScenarioId: failureRecord.scenarioId, phaseGate: failureRecord.phaseGate, preserved, reruns, state: { releaseProgression: "stopped", externalAuthority: "disabled", improvementAuthority: "disabled" } };
    if (options.reportPath) await writeJson(options.reportPath, report);
    return report;
  } catch (error) {
    return { status: "blocked", blockers: [error instanceof Error ? error.message : String(error)], reruns: [] };
  }
}
function joinFallback(statePath, candidateId) { return resolve(dirname(resolve(statePath)), `rollback-${candidateId}`); }
function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") { console.error("Usage: node scripts/release-rollback.mjs --input <manifest.json> [--report <path>]"); process.exit(2); }
    if (!["--input", "--report"].includes(arg)) throw new Error(`Unknown option: ${arg}`);
    const value = argv[++index];
    if (value === undefined || value.startsWith("--")) throw new Error(`${arg} requires a value`);
    result[arg.slice(2).replaceAll("-", "_")] = value;
  }
  return result;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.input) throw new Error("--input is required");
    const input = await readJson(args.input, "rollback manifest");
    const result = await runRollback({ ...input, ...(args.report ? { reportPath: args.report } : {}) });
    console.log(JSON.stringify({ status: result.status, candidateId: result.candidateId ?? null, blockers: result.blockers ?? [], reportPath: args.report ? resolve(args.report) : null }));
    process.exitCode = result.status === "rolled_back" ? 0 : 2;
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
