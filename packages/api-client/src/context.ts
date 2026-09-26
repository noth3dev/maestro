import type { GoalControlInput, GoalResult } from "@maestro/contracts";
import type { Fetch } from "./transport.js";

export interface MethodContext {
  readonly request: <T>(path: string, init: RequestInit, parse: { parse(value: unknown): T }, timeoutMs?: number) => Promise<T>;
  readonly headers: Record<string, string>;
  readonly controlGoal: (
    goalId: string,
    input: GoalControlInput,
    commandId: string,
    action: "pause" | "stop" | "resume" | "emergency-stop",
  ) => Promise<GoalResult>;
  readonly fetch: Fetch;
  readonly base: URL;
}
