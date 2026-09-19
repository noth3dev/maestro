#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(SCRIPT_DIR, "..");
export const DEFAULT_TUI_COMMAND = [process.execPath, join(REPO_ROOT, "apps/cli/dist/main.js")];
export const DEFAULT_TUI_CAPTURE_SIZES = Object.freeze([
  Object.freeze({ columns: 80, rows: 24 }),
  Object.freeze({ columns: 120, rows: 40 }),
  Object.freeze({ columns: 200, rows: 50 }),
]);

const SAFE_ENVIRONMENT_KEYS = Object.freeze(["PATH", "LANG", "LC_ALL", "TZ"]);

export function buildCaptureEnvironment(environment = process.env, homeDirectory) {
  const safe = {};
  for (const key of SAFE_ENVIRONMENT_KEYS) {
    const value = environment[key];
    if (typeof value === "string" && value !== "") safe[key] = value;
  }
  safe.TERM = "screen-256color";
  safe.MAESTRO_DISABLE_LOCAL_AUTOSTART = "true";
  if (homeDirectory !== undefined) safe.HOME = homeDirectory;
  return safe;
}

const NAMED_SCENARIOS = Object.freeze({
  home: Object.freeze([Object.freeze({ type: "wait", milliseconds: 1_000 }), Object.freeze({ type: "capture", name: "home" })]),
  help: Object.freeze([
    Object.freeze({ type: "wait", milliseconds: 1_000 }),
    Object.freeze({ type: "command", command: "/help" }),
    Object.freeze({ type: "wait", milliseconds: 250 }),
    Object.freeze({ type: "capture", name: "help" }),
  ]),
});

/** @typedef {{ type: "wait", milliseconds: number } | { type: "text", text: string } | { type: "keys", keys: string | readonly string[] } | { type: "command", command: string } | { type: "capture", name?: string }} TuiCaptureStep */

/** @typedef {{ stdout?: string, stderr?: string }} TmuxResult */
/** @typedef {(args: readonly string[]) => Promise<TmuxResult>} RunTmux */

const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

export function resolveScenario(scenario = "home") {
  if (typeof scenario === "string") {
    const named = NAMED_SCENARIOS[scenario];
    if (named === undefined) throw new Error(`Unknown TUI capture scenario: ${scenario}`);
    return named.map((step) => ({ ...step }));
  }
  return scenario.map((step) => ({ ...step }));
}

/** Preserve the current operator environment for explicitly requested live runs. */
export function buildLiveCaptureEnvironment(environment = process.env) {
  const live = {};
  for (const [key, value] of Object.entries(environment)) {
    if (value !== undefined && key !== "NO_COLOR" && key !== "COLORTERM") live[key] = value;
  }
  live.TERM = "screen-256color";
  return live;
}

function createSessionName(columns, rows) {
  return `maestro-e4-${process.pid}-${columns}x${rows}-${randomUUID()}`;
}

function validateSize(columns, rows) {
  if (!Number.isInteger(columns) || columns < 20) throw new Error(`Invalid terminal columns: ${columns}`);
  if (!Number.isInteger(rows) || rows < 8) throw new Error(`Invalid terminal rows: ${rows}`);
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function isMissingSessionError(error) {
  const text = [error?.message, error?.stderr].filter((value) => typeof value === "string").join("\n");
  return /no server running|session does not exist|can't find session|no such session/i.test(text);
}

async function hasSession(runTmux, session) {
  try {
    await runTmux(["has-session", "-t", session]);
    return true;
  } catch (error) {
    if (isMissingSessionError(error)) return false;
    throw error;
  }
}

function createTmuxRunner(options = {}) {
  return async (args) => {
    const result = await execFileAsync("tmux", [...args], {
      cwd: options.cwd ?? REPO_ROOT,
      env: options.env ?? process.env,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  };
}

function launchArguments({ session, columns, rows, cwd, command, noColor, environment }) {
  const safeEnvironment = { ...environment };
  if (noColor) safeEnvironment.NO_COLOR = "1";
  const assignments = Object.entries(safeEnvironment).map(([key, value]) => `${key}=${value}`);
  return [
    "new-session",
    "-d",
    "-x",
    String(columns),
    "-y",
    String(rows),
    "-s",
    session,
    "-c",
    cwd,
    "--",
    "env",
    "-i",
    ...assignments,
    ...command,
  ];
}

async function sendText(runTmux, target, text) {
  await runTmux(["send-keys", "-t", target, "-l", text]);
}

async function sendKeys(runTmux, target, keys) {
  const values = typeof keys === "string" ? [keys] : keys;
  if (values.length === 0) return;
  await runTmux(["send-keys", "-t", target, ...values]);
}

async function captureFrame(runTmux, target, name) {
  const [ansiResult, plainResult] = await Promise.all([
    runTmux(["capture-pane", "-e", "-p", "-t", target]),
    runTmux(["capture-pane", "-p", "-t", target]),
  ]);
  const ansi = ansiResult.stdout ?? "";
  const plain = plainResult.stdout ?? "";
  return { name, ansi, plain, ansiSha256: sha256(ansi), plainSha256: sha256(plain) };
}

function composerContainsCommand(frame, command) {
  return frame.plain.split(/\r?\n/).some((line) => line.includes(`› ${command}`) || line.includes(`›${command}`));
}

async function waitForReadiness(runTmux, target, marker, wait, timeoutMilliseconds = 5_000) {
  const pollMilliseconds = 50;
  const maxPolls = Math.max(1, Math.ceil(timeoutMilliseconds / pollMilliseconds));
  for (let poll = 0; poll < maxPolls; poll += 1) {
    const frame = await captureFrame(runTmux, target, "readiness-probe");
    if (frame.plain.includes(marker)) return;
    await wait(pollMilliseconds);
  }
  throw new Error(`TUI readiness marker did not appear within ${timeoutMilliseconds}ms: ${marker}`);
}

async function submitCommand(runTmux, target, command, wait, timeoutMilliseconds = 1_000) {
  await sendText(runTmux, target, command);
  await sendKeys(runTmux, target, "Enter");
  await wait(50);
  let probe = await captureFrame(runTmux, target, "command-submit-probe");
  if (!composerContainsCommand(probe, command)) return;

  // The first Enter accepted argument completion but left the exact command in the composer.
  await sendKeys(runTmux, target, "Enter");
  const pollMilliseconds = 50;
  const maxPolls = Math.max(1, Math.ceil(timeoutMilliseconds / pollMilliseconds));
  for (let poll = 0; poll < maxPolls; poll += 1) {
    await wait(pollMilliseconds);
    probe = await captureFrame(runTmux, target, "command-submit-settle");
    if (!composerContainsCommand(probe, command)) return;
  }
  throw new Error(`TUI command did not submit within ${timeoutMilliseconds}ms: ${command}`);
}

/**
 * Start one real TUI process in one real tmux pane, drive a named/custom
 * scenario, and return the ANSI-preserving and plain rendered frames.
 */
export async function captureScenario(options) {
  const columns = options.columns;
  const rows = options.rows;
  validateSize(columns, rows);
  const cwd = options.cwd ?? REPO_ROOT;
  const tmuxEnvironment =
    options.liveEnvironment === true
      ? buildLiveCaptureEnvironment({ ...process.env, ...options.environment })
      : buildCaptureEnvironment({ ...process.env, ...options.environment });
  const runTmux = options.runTmux ?? createTmuxRunner({ cwd, env: tmuxEnvironment });
  const wait = options.wait ?? sleep;
  const command = options.command ?? DEFAULT_TUI_COMMAND;
  const session = createSessionName(columns, rows);
  const target = `${session}:0.0`;
  const frames = [];
  let ownsSession = false;
  let operationError;
  let cleanupError;
  let result;
  const steps = resolveScenario(options.scenario ?? "home");
  const startupWait = options.startupWaitMilliseconds ?? (options.liveEnvironment === true ? 3_000 : 1_500);
  const readinessMarker = options.readinessMarker ?? (options.liveEnvironment === true ? "Session attached" : undefined);
  const homeDirectory = options.liveEnvironment === true ? undefined : await mkdtemp(join(tmpdir(), "maestro-e4-home-"));
  const childEnvironment =
    options.liveEnvironment === true
      ? buildLiveCaptureEnvironment({ ...process.env, ...options.environment })
      : buildCaptureEnvironment({ ...process.env, ...options.environment }, homeDirectory);

  try {
    if (await hasSession(runTmux, session)) throw new Error(`Refusing to reuse existing tmux session: ${session}`);
    ownsSession = true;
    await runTmux(
      launchArguments({
        session,
        columns,
        rows,
        cwd,
        command,
        noColor: options.noColor === true,
        environment: childEnvironment,
      }),
    );
    await runTmux(["has-session", "-t", session]);
    if (startupWait > 0) await wait(startupWait);
    if (readinessMarker !== undefined) {
      await waitForReadiness(runTmux, target, readinessMarker, wait, options.readinessTimeoutMilliseconds);
    }
    for (const [index, step] of steps.entries()) {
      if (step.type === "wait") {
        if (step.milliseconds > 0) await wait(step.milliseconds);
      } else if (step.type === "text") {
        await sendText(runTmux, target, step.text);
      } else if (step.type === "keys") {
        await sendKeys(runTmux, target, step.keys);
      } else if (step.type === "command") {
        await submitCommand(runTmux, target, step.command, wait, options.commandSubmitTimeoutMilliseconds);
      } else if (step.type === "capture") {
        frames.push(await captureFrame(runTmux, target, step.name ?? `frame-${index + 1}`));
      }
    }
    result = {
      session,
      columns,
      rows,
      noColor: options.noColor === true,
      environment: { TERM: "screen-256color", ...(options.noColor === true ? { NO_COLOR: "1" } : {}) },
      scenario: options.scenario ?? "home",
      frames,
    };
  } catch (error) {
    operationError = error;
  } finally {
    if (ownsSession) {
      try {
        if (await hasSession(runTmux, session)) await runTmux(["kill-session", "-t", session]);
      } catch (error) {
        cleanupError = error;
      }
    }
    if (homeDirectory !== undefined) {
      try {
        await rm(homeDirectory, { recursive: true, force: true });
      } catch (error) {
        cleanupError ??= error;
      }
    }
  }

  if (cleanupError !== undefined) {
    if (operationError !== undefined) throw new AggregateError([operationError, cleanupError], `TUI capture cleanup failed for ${session}`);
    throw cleanupError;
  }
  if (operationError !== undefined) throw operationError;
  return result;
}

function frameIdentity(result) {
  return result.frames.map((frame) => `${frame.name}:${frame.ansiSha256}:${frame.plainSha256}`).join("\n");
}

/** Run the same real scenario twice and fail if rendered output differs. */
export async function assertReproducible(options) {
  const first = await captureScenario(options);
  const second = await captureScenario(options);
  if (frameIdentity(first) !== frameIdentity(second)) {
    throw new Error(
      `TUI capture is not reproducible for ${options.columns}x${options.rows} (${options.noColor === true ? "NO_COLOR" : "color"})`,
    );
  }
  return { first, second };
}

/** Capture the required 80x24, 120x40, and 200x50 matrix in both color modes. */
export async function captureMatrix(options = {}) {
  const sizes = options.sizes ?? DEFAULT_TUI_CAPTURE_SIZES;
  const colorModes = options.colorModes ?? [false, true];
  const reproducible = options.reproducible ?? true;
  const results = [];
  for (const size of sizes) {
    for (const noColor of colorModes) {
      const capture = reproducible
        ? (await assertReproducible({ ...options, ...size, noColor })).first
        : await captureScenario({ ...options, ...size, noColor });
      results.push({ ...capture, reproducible });
    }
  }
  return results;
}

function frameMetadata(frame) {
  const metadata = { ...frame };
  delete metadata.ansi;
  delete metadata.plain;
  return metadata;
}

function safeFilePart(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "frame";
}

async function writeCaptureResult(result, outputDirectory) {
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  await chmod(outputDirectory, 0o700);
  await writeFile(
    join(outputDirectory, "capture.json"),
    `${JSON.stringify({ ...result, frames: result.frames.map(frameMetadata) }, null, 2)}\n`,
    { mode: 0o600 },
  );
  await chmod(join(outputDirectory, "capture.json"), 0o600);
  await Promise.all(
    result.frames.flatMap((frame) => [
      writeFile(join(outputDirectory, `${safeFilePart(frame.name)}.ansi.txt`), frame.ansi, { mode: 0o600 }),
      writeFile(join(outputDirectory, `${safeFilePart(frame.name)}.txt`), frame.plain, { mode: 0o600 }),
    ]),
  );
}

async function writeMatrixResults(results, outputDirectory) {
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  await chmod(outputDirectory, 0o700);
  for (const result of results) {
    const directory = join(outputDirectory, `${result.columns}x${result.rows}-${result.noColor ? "no-color" : "color"}`);
    await writeCaptureResult(result, directory);
  }
  const manifest = results.map(({ frames, ...result }) => ({
    ...result,
    frames: frames.map(frameMetadata),
  }));
  await writeFile(join(outputDirectory, "matrix.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await chmod(join(outputDirectory, "matrix.json"), 0o600);
}

function parseSizeList(raw) {
  const sizes = raw.split(",").map((value) => {
    const match = /^(\d+)x(\d+)$/.exec(value.trim());
    if (match === null) throw new Error(`Invalid terminal size: ${value}`);
    return { columns: Number(match[1]), rows: Number(match[2]) };
  });
  sizes.forEach(({ columns, rows }) => validateSize(columns, rows));
  return sizes;
}

function parseCli(argv) {
  const values = {
    scenario: "home",
    matrix: false,
    reproducible: false,
    noReproducibility: false,
    noColor: false,
    live: false,
    outputDirectory: undefined,
    colorModes: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--matrix") values.matrix = true;
    else if (arg === "--reproducible") values.reproducible = true;
    else if (arg === "--no-reproducibility") values.noReproducibility = true;
    else if (arg === "--no-color") {
      values.noColor = true;
      values.colorModes = [true];
      values.matrix = true;
    } else if (arg === "--color") {
      values.noColor = false;
      values.colorModes = [false];
      values.matrix = true;
    } else if (arg === "--live") values.live = true;
    else if (arg === "--scenario") values.scenario = argv[++index];
    else if (arg === "--sizes") {
      values.sizes = parseSizeList(argv[++index]);
      values.matrix = true;
    } else if (arg === "--out" || arg === "--output-dir") values.outputDirectory = argv[++index];
    else if (arg === "--columns") values.columns = Number(argv[++index]);
    else if (arg === "--rows") values.rows = Number(argv[++index]);
    else if (arg === "--help" || arg === "-h") values.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (values.reproducible && values.noReproducibility) {
    throw new Error("--reproducible and --no-reproducibility are mutually exclusive");
  }
  return values;
}

function cliHelp() {
  return [
    "Usage: node scripts/tui-capture.mjs [options]",
    "",
    "  --scenario <home|help>  Named scenario (default: home)",
    "  --matrix                Capture required sizes in both color modes",
    "  --sizes <WxH,...>       Matrix sizes (default: 80x24,120x40,200x50)",
    "  --color                 Matrix color mode only",
    "  --no-color              Set NO_COLOR=1 (matrix no-color mode only)",
    "  --reproducible          Capture one scenario twice and compare hashes",
    "  --no-reproducibility    Capture a matrix once without claiming stable output",
    "  --live                  Preserve the current operator environment/login state",
    "  --columns <n>           Single-capture terminal width (default: 120)",
    "  --rows <n>              Single-capture terminal height (default: 40)",
    "  --out <path>            Write frames and metadata to this directory",
  ].join("\n");
}

async function main() {
  const values = parseCli(process.argv.slice(2));
  if (values.help === true) {
    process.stdout.write(`${cliHelp()}\n`);
    return;
  }
  const scenario = values.scenario;
  if (values.matrix) {
    const results = await captureMatrix({
      scenario,
      sizes: values.sizes,
      colorModes: values.colorModes,
      liveEnvironment: values.live,
      reproducible: !values.noReproducibility,
    });
    if (values.outputDirectory !== undefined) await writeMatrixResults(results, values.outputDirectory);
    process.stdout.write(
      `${JSON.stringify(
        results.map(({ frames, ...result }) => ({ ...result, frames: frames.map(frameMetadata) })),
        null,
        2,
      )}\n`,
    );
    return;
  }
  const options = {
    scenario,
    columns: values.columns ?? 120,
    rows: values.rows ?? 40,
    noColor: values.noColor,
    liveEnvironment: values.live,
  };
  if (values.reproducible) {
    const result = await assertReproducible(options);
    if (values.outputDirectory !== undefined) await writeCaptureResult(result.first, values.outputDirectory);
    process.stdout.write(
      `${JSON.stringify({ reproducible: true, ...result.first, frames: result.first.frames.map(frameMetadata) }, null, 2)}\n`,
    );
    return;
  }
  const result = await captureScenario(options);
  if (values.outputDirectory !== undefined) await writeCaptureResult(result, values.outputDirectory);
  process.stdout.write(`${JSON.stringify({ ...result, frames: result.frames.map(frameMetadata) }, null, 2)}\n`);
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) await main();
