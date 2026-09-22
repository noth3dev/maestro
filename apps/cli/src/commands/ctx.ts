import type { ApiClient, GoalEvent, GoalResult } from "@maestro/api-client";
import type { CliIo, Env } from "../main.js";
import type { CliOptionName } from "./options.js";

/**
 * Everything a resource command handler needs. main.ts owns arg parsing and
 * connection setup; handlers below it only see this context plus the
 * resource/action pair, and return true when they handled the command.
 */
export interface CommandCtx {
  client: ApiClient;
  io: CliIo;
  env: Env;
  json: boolean;
  string: (name: CliOptionName) => string;
  value: (name: CliOptionName) => string | boolean | undefined;
}

export function requiredOption(value: string | boolean | undefined, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

export function nonNegativeInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${option} must be a non-negative integer`);
  return parsed;
}

export function safeInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 1_000_000_000) throw new Error(`${option} must be a nonnegative safe integer no greater than 1000000000`);
  return parsed;
}

export function parseJsonOption<T extends object = Record<string, unknown>>(value: string, option: string): T {
  try { return JSON.parse(value); } catch { throw new Error(`${option} must contain valid JSON`); }
}

export function printGoal(write: CliIo["stdout"], result: GoalResult, json: boolean): void {
  write(json ? `${JSON.stringify(result)}\n` : `Goal ${result.goalId}: ${result.state} (version ${result.version})\n`);
}

export function printState(write: CliIo["stdout"], result: unknown, json: boolean): void { write(json ? `${JSON.stringify(result)}\n` : `${JSON.stringify(result)}\n`); }

export function printEvents(write: CliIo["stdout"], events: GoalEvent[], nextCursor: string): void {
  if (events.length === 0) write(`Events: 0 (next cursor: ${nextCursor})\n`);
  else for (const event of events) write(`${event.cursor} ${event.eventType} goal=${event.goalId}\n`);
}
