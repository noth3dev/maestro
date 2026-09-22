#!/usr/bin/env node
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { ApiError, createApiClient } from "@maestro/api-client";
import { startInteractiveTui } from "./tui/entry.js";
import { resolveConnection, resolveLocalConnection } from "@maestro/local-backend";
import { MAESTRO_VERSION } from "./version.js";
import { cliOptions, type CliOptionName } from "./commands/options.js";
import { requiredOption, type CommandCtx } from "./commands/ctx.js";
import { runAdminCommands } from "./commands/admin.js";
import { runTaskContractCommands } from "./commands/task-contract.js";
import { runAuthCommands } from "./commands/auth.js";
import { runConversationCommands } from "./commands/conversation.js";
import { runGoalCommands } from "./commands/goals.js";
import { runDeliberationCommands } from "./commands/deliberation.js";
import { runExecutionCommands } from "./commands/execution.js";
import { runReportingCommands } from "./commands/reporting.js";

export interface CliIo {
  fetch?: typeof globalThis.fetch;
  /** Opens a provider-owned login URL without passing account secrets through argv. */
  openExternalUrl?: (url: string) => Promise<void>;
  /** Copies a provider-owned login URL without passing it through a shell or argv. */
  copyToClipboard?: (text: string) => Promise<void>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Reads a secret without echoing it; primarily supplied by tests or embedding hosts. */
  readSecret?: (prompt: string) => Promise<string>;
  startTui?: (cwd: string, env: Env, io: CliIo) => Promise<number>;
}

export type Env = Record<string, string | undefined>;

export async function executeCli(args: string[], env: Env, io: CliIo): Promise<number> {
  if (args.includes("--help") || args[0] === "help") {
    io.stdout(helpText());
    return 0;
  }
  if (args[0] === "--version" || args[0] === "-V") {
    io.stdout(`${MAESTRO_VERSION}\n`);
    return 0;
  }
  if (args.length === 0) {
    return (io.startTui ?? ((cwd, environment, tuiIo) => startInteractiveTui({ cwd, env: environment, io: tuiIo })))(process.cwd(), env, io);
  }
  try {
    const connection = await resolveCliConnection(env, io.fetch);
    const baseUrl = connection.apiUrl;
    const token = connection.token;
    const parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: cliOptions,
    });
    const client = createApiClient({ baseUrl, token, ...(io.fetch === undefined ? {} : { fetch: io.fetch }) });
    let [resource, action] = parsed.positionals;
    if (resource === "model") resource = "models";
    if (resource === "models" && action === undefined) action = "list";
    if (parsed.positionals.length > 2) throw new Error("Unexpected positional argument");
    const value = (name: CliOptionName) => parsed.values[name] as string | boolean | undefined;
    const string = (name: CliOptionName) => requiredOption(value(name), `--${name}`);
    const json = parsed.values.json === true;
    const ctx: CommandCtx = { client, io, env, json, string, value };

    if (await runAdminCommands(ctx, resource, action)) return 0;
    if (await runTaskContractCommands(ctx, resource, action)) return 0;
    if (await runAuthCommands(ctx, resource, action)) return 0;
    if (await runConversationCommands(ctx, resource, action)) return 0;
    if (await runGoalCommands(ctx, resource, action)) return 0;
    if (await runDeliberationCommands(ctx, resource, action)) return 0;
    if (await runExecutionCommands(ctx, resource, action)) return 0;
    if (await runReportingCommands(ctx, resource, action)) return 0;
    throw new Error("Usage: maestro login openai|anthropic|logout openai|anthropic|models list|goal create|get|transition|pause|stop|resume|emergency-stop|head activate|council create|get|submit-brief|reveal|decide|department-plan create|get|revise|mission-bundle create|get|worker spawn|get|message|observe|cancel|accept|certify|certify-conditional|git goal-branch|department-branch|worker-worktree|worker-advance|goal-revision|metronome scan|challenge|concertmaster-report generate|get|encore review|critical-action request|approve-and-run|capability select-full-access-mode|evidence capture|dump|budget ... | maestro events list ...");
  } catch (error) {
    const message = error instanceof ApiError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : "Command failed";
    io.stderr(`${message}\n`);
    return error instanceof ApiError ? 1 : 2;
  }
}

function helpText(): string {
  return `Maestro CLI\n\nConnection (required except help): MAESTRO_API_URL, MAESTRO_API_TOKEN\n\nCommands:\n  login openai|anthropic   (reads API key without echoing it)\n  logout openai|anthropic\n  admin project-access --operator-id --project-id --roles-json\n  goal create|get|transition|pause|stop|resume|emergency-stop\n  models list (also: model list)\n  conversation create|get|turn|cancel\n  goals list\n  budget get\n  task-contract create|get|amend|select-roles|confirm|launch\n  head activate\n  council create|get|submit-brief|reveal|decide\n  department-plan create|get|revise\n  mission-bundle create|get\n  worker spawn|get|observe|cancel|accept|certify|certify-conditional\n  workers list\n  git goal-branch|department-branch|worker-worktree|goal-revision|status\n  metronome scan|challenge\n  metronome-challenges list\n  encore review\n  encore-council list\n  certifications list\n  concertmaster-report generate|get\n  evidence dump\n  improvement-digests list\n  critical-action request|approve-and-run\n  capability select-full-access-mode\n  evidence capture|dump\n  events list\n\nUse --json for machine-readable output.\n`;
}

async function resolveCliConnection(env: Env, fetch: typeof globalThis.fetch | undefined): Promise<{ apiUrl: string; token: string }> {
  // Keep non-interactive commands explicit when a bearer token is supplied by
  // hand. Bare interactive `maestro` is the path that owns local auto-setup.
  if ((env.MAESTRO_API_URL?.trim() ?? "") === "" && (env.MAESTRO_API_TOKEN?.trim() ?? "") !== "") {
    throw new Error("MAESTRO_API_URL is required");
  }
  const direct = await resolveConnection(env);
  if (direct.kind === "configured") return direct;
  if ((env.MAESTRO_API_URL?.trim() ?? "") !== "" || (env.MAESTRO_API_TOKEN?.trim() ?? "") !== "" || env.MAESTRO_DISABLE_LOCAL_AUTOSTART === "true") {
    throw new Error(direct.reason);
  }
  const local = await resolveLocalConnection({ env, ...(fetch === undefined ? {} : { fetch }) });
  if (local.kind !== "configured") throw new Error(local.reason);
  return local;
}

export function shouldRunAsMain(moduleUrl: string, argvPath: string | undefined, resolvePath: (path: string) => string = realpathSync): boolean {
  if (argvPath === undefined) return false;
  try {
    return fileURLToPath(moduleUrl) === resolvePath(argvPath);
  } catch {
    return false;
  }
}

if (shouldRunAsMain(import.meta.url, process.argv[1])) {
  void executeCli(process.argv.slice(2), process.env, { fetch: globalThis.fetch, stdout: (text) => process.stdout.write(text), stderr: (text) => process.stderr.write(text) }).then((code) => { process.exitCode = code; });
}
