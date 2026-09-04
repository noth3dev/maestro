#!/usr/bin/env node
import { parseArgs } from "node:util";
import { ApiError, createApiClient, type GoalEvent, type GoalResult } from "@maestro/api-client";

export interface CliIo {
  fetch?: typeof globalThis.fetch;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

type Env = Record<string, string | undefined>;

export async function executeCli(args: string[], env: Env, io: CliIo): Promise<number> {
  try {
    const baseUrl = requireEnvironment(env, "MAESTRO_API_URL");
    const token = requireEnvironment(env, "MAESTRO_API_TOKEN");
    const parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        "project-id": { type: "string" },
        "goal-id": { type: "string" },
        "command-id": { type: "string" },
        "expected-version": { type: "string" },
        to: { type: "string" },
        after: { type: "string" },
        json: { type: "boolean", default: false },
      },
    });
    const client = createApiClient({ baseUrl, token, ...(io.fetch === undefined ? {} : { fetch: io.fetch }) });
    const [resource, action] = parsed.positionals;
    const value = (name: keyof typeof parsed.values) => parsed.values[name];
    const string = (name: keyof typeof parsed.values) => requiredOption(value(name), `--${name}`);
    const json = parsed.values.json === true;

    if (resource === "goal" && action === "create") {
      const result = await client.createGoal({ projectId: string("project-id") }, string("command-id"));
      printGoal(io.stdout, result, json);
      return 0;
    }
    if (resource === "goal" && action === "get") {
      const result = await client.getGoal(string("goal-id"), { projectId: string("project-id") });
      printGoal(io.stdout, result, json);
      return 0;
    }
    if (resource === "goal" && action === "transition") {
      const expectedVersion = Number(string("expected-version"));
      if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new Error("--expected-version must be a non-negative integer");
      const result = await client.transitionGoal(string("goal-id"), { projectId: string("project-id"), expectedVersion, to: string("to") as GoalResult["state"] }, string("command-id"));
      printGoal(io.stdout, result, json);
      return 0;
    }
    if (resource === "sentinel-challenges" && action === "list") { const result=await client.listSentinelChallenges(string("goal-id")); printState(io.stdout,result,json); return 0; }
    if (resource === "encore-council" && action === "list") { const result=await client.listEncoreCouncilRounds(string("goal-id")); printState(io.stdout,result,json); return 0; }
    if (resource === "certifications" && action === "list") { const result=await client.listCertifications(string("goal-id")); printState(io.stdout,result,json); return 0; }
    if (resource === "sane-report" && action === "get") { const result=await client.getSaneReport(string("goal-id")); printState(io.stdout,result,json); return 0; }
    if (resource === "events" && action === "list") {
      const page = await client.listEvents({ projectId: string("project-id"), after: value("after") === undefined ? "0" : string("after") });
      if (json) io.stdout(`${JSON.stringify(page)}\n`);
      else printEvents(io.stdout, page.events, page.nextCursor);
      return 0;
    }
    throw new Error("Usage: maestro goal create|get|transition ... | maestro events list ...");
  } catch (error) {
    const message = error instanceof ApiError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : "Command failed";
    io.stderr(`${message}\n`);
    return error instanceof ApiError ? 1 : 2;
  }
}

function requireEnvironment(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredOption(value: string | boolean | undefined, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function printGoal(write: CliIo["stdout"], result: GoalResult, json: boolean): void {
  write(json ? `${JSON.stringify(result)}\n` : `Goal ${result.goalId}: ${result.state} (version ${result.version})\n`);
}

function printState(write: CliIo["stdout"], result: unknown, json: boolean): void { write(json ? `${JSON.stringify(result)}\n` : `${JSON.stringify(result)}\n`); }

function printEvents(write: CliIo["stdout"], events: GoalEvent[], nextCursor: string): void {
  if (events.length === 0) write(`Events: 0 (next cursor: ${nextCursor})\n`);
  else for (const event of events) write(`${event.cursor} ${event.eventType} goal=${event.goalId}\n`);
}

if (import.meta.url === new URL(process.argv[1]!, "file:").href) {
  void executeCli(process.argv.slice(2), process.env, { fetch: globalThis.fetch, stdout: (text) => process.stdout.write(text), stderr: (text) => process.stderr.write(text) }).then((code) => { process.exitCode = code; });
}
