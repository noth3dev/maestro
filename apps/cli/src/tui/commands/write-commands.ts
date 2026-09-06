import { randomUUID } from "node:crypto";
import type { ApiClient } from "@maestro/api-client";
import type { ParsedCommand } from "./parser.js";
import { createCommandRegistry } from "./registry.js";
import { confirmCriticalAction, type ConfirmationPrompt } from "../confirmation.js";

export interface WriteCommandContext {
  client: ApiClient;
  projectId: string;
  goalId?: string;
  confirm: ConfirmationPrompt;
}

export interface WriteCommandResult { title: string; lines: string[] }

const unavailable = (message: string): WriteCommandResult => ({ title: "Unavailable", lines: [message] });

function option(command: ParsedCommand, name: string): string | undefined {
  const value = command.options[name];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function required(command: ParsedCommand, name: string): string | WriteCommandResult {
  return option(command, name) ?? unavailable(`Missing required option --${name}`);
}

function integer(command: ParsedCommand, name: string): number | WriteCommandResult {
  const value = required(command, name);
  if (typeof value !== "string") return value;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : unavailable(`--${name} must be a non-negative integer`);
}

function commandId(command: ParsedCommand): string { return option(command, "command-id") ?? randomUUID(); }
function result(title: string, value: { goalId?: string; state?: string; version?: number }): WriteCommandResult {
  const identity = value.goalId === undefined ? title : `Goal ${value.goalId}`;
  const details = value.state === undefined ? "completed" : `${value.state}${value.version === undefined ? "" : ` · v${value.version}`}`;
  return { title, lines: [`${identity} · ${details}`] };
}

async function confirmIfCritical(context: WriteCommandContext, command: ParsedCommand, target: string): Promise<WriteCommandResult | undefined> {
  const definition = createCommandRegistry().find(command.name);
  const action = definition?.actions.find((item) => item.name === command.action);
  if (action?.kind !== "critical") return undefined;
  const decision = await confirmCriticalAction({
    action: `${command.name}.${command.action ?? ""}`.replace(/\.$/, ""),
    target,
    ...(context.goalId === undefined ? {} : { goalId: context.goalId }),
    effect: `Execute ${command.name} ${command.action ?? ""}`.trim(),
    expiresAt: option(command, "expires-at") ?? "server-defined",
  }, context.confirm);
  return decision === "cancelled" ? { title: "Cancelled", lines: ["No mutation was sent."] } : undefined;
}

export async function executeWriteCommand(context: WriteCommandContext, command: ParsedCommand): Promise<WriteCommandResult> {
  const definition = createCommandRegistry().find(command.name);
  const action = definition?.actions.find((item) => item.name === command.action);
  if (action === undefined) return unavailable(`Unknown command: ${command.name} ${command.action ?? ""}`.trim());
  if (action.kind === "read") return unavailable(`${command.name} ${command.action ?? ""} is a read; use the read command path`.trim());

  const target = option(command, "target") ?? option(command, "goal-id") ?? context.goalId ?? context.projectId;
  const cancelled = await confirmIfCritical(context, command, target);
  if (cancelled !== undefined) return cancelled;
  const id = commandId(command);

  if (command.name === "goal" && command.action === "create") {
    const contractId = option(command, "contract-id");
    const created = await context.client.createGoal({ projectId: context.projectId, ...(contractId === undefined ? {} : { contractId }) }, id);
    return result("Goal", created);
  }
  if (command.name === "goal" && command.action === "transition") {
    const goalId = required(command, "goal-id"); const expectedVersion = integer(command, "expected-version"); const to = required(command, "to");
    if (typeof goalId !== "string") return goalId;
    if (typeof expectedVersion !== "number") return expectedVersion;
    if (typeof to !== "string") return to;
    const updated = await context.client.transitionGoal(goalId, { projectId: context.projectId, expectedVersion, to: to as never }, id);
    return result("Goal", updated);
  }
  if (command.name === "goal" && ["pause", "stop", "resume", "emergency-stop"].includes(command.action ?? "")) {
    const goalId = required(command, "goal-id"); const expectedVersion = integer(command, "expected-version");
    if (typeof goalId !== "string") return goalId;
    if (typeof expectedVersion !== "number") return expectedVersion;
    const input = { projectId: context.projectId, expectedVersion };
    const updated = command.action === "pause" ? await context.client.pauseGoal(goalId, input, id)
      : command.action === "stop" ? await context.client.stopGoal(goalId, input, id)
        : command.action === "resume" ? await context.client.resumeGoal(goalId, input, id)
          : await context.client.emergencyStopGoal(goalId, input, id);
    return result("Goal", updated);
  }
  if (command.name === "metronome" && command.action === "safe-pause") {
    const goalId = required(command, "goal-id"); const challengeId = required(command, "challenge-id");
    if (typeof goalId !== "string") return goalId;
    if (typeof challengeId !== "string") return challengeId;
    const updated = await context.client.requestMetronomeSafePause(goalId, challengeId, { projectId: context.projectId }, id);
    return { title: "Metronome", lines: [`${updated.challengeId} · ${updated.status}`] };
  }
  return unavailable(`${command.name} ${command.action ?? ""} is not yet wired to a typed write handler`.trim());
}
