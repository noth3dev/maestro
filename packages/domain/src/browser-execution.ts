export type BrowserAction = "navigate" | "click" | "fill" | "get_text" | "screenshot";

export interface BrowserCommandRequest {
  readonly commandId: string;
  readonly actorId: string;
  readonly action: BrowserAction;
  /** URL for navigate; CSS selector for click/fill/get_text; ignored for screenshot. */
  readonly target: string;
  /** Required only for fill. */
  readonly value?: string;
  readonly policyVersion: number;
  readonly budgetEffectCents: number;
  readonly controlEpoch: string;
  readonly timeoutMs?: number;
}

export type BrowserCommandStatus = "running" | "succeeded" | "failed" | "cancelled" | "timed_out";

export interface BrowserCommandResult {
  readonly invocationId: string;
  readonly status: BrowserCommandStatus;
  /** Bounded text captured by get_text. Never raw page HTML or arbitrary script output. */
  readonly capturedText: string | null;
  /** Content-addressed reference to a captured screenshot; never raw bytes on this result. */
  readonly evidenceRef: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly error?: string;
}

export interface BrowserCommandHandle {
  readonly invocationId: string;
  observe(): Promise<BrowserCommandResult>;
  cancel(reason?: string): Promise<{ cancelled: boolean }>;
}

/** Adapter boundary. Implementations must bind every command to one environment record. */
export interface BrowserExecutionPort {
  start(request: BrowserCommandRequest): Promise<BrowserCommandHandle>;
}

const BROWSER_ACTIONS: readonly BrowserAction[] = ["navigate", "click", "fill", "get_text", "screenshot"];
const MAX_TARGET_LENGTH = 2048;
const MAX_VALUE_LENGTH = 4096;

function nonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

export function assertValidBrowserCommandRequest(value: unknown): asserts value is BrowserCommandRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Browser command must be an object");
  const r = value as Partial<BrowserCommandRequest>;
  if (!nonblank(r.commandId) || !nonblank(r.actorId) || !nonblank(r.controlEpoch)) {
    throw new Error("Browser command identity and authority fields are required");
  }
  if (!BROWSER_ACTIONS.includes(r.action as BrowserAction)) throw new Error(`Browser command action is invalid: ${String(r.action)}`);
  if (!Number.isSafeInteger(r.policyVersion) || (r.policyVersion as number) < 1) throw new Error("Browser command policyVersion is invalid");
  if (typeof r.budgetEffectCents !== "number" || !Number.isSafeInteger(r.budgetEffectCents) || r.budgetEffectCents < 0) {
    throw new Error("Browser command budgetEffectCents is invalid");
  }
  if (r.action !== "screenshot") {
    if (!nonblank(r.target) || (r.target as string).length > MAX_TARGET_LENGTH || (r.target as string).includes("\0")) {
      throw new Error("Browser command target is required and must be a bounded, NUL-free string");
    }
  }
  if (r.action === "navigate") {
    let parsed: URL;
    try {
      parsed = new URL(r.target as string);
    } catch {
      throw new Error("Browser navigate target must be a valid URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Browser navigate target must be http or https");
  }
  if (r.action === "fill") {
    if (typeof r.value !== "string" || r.value.length > MAX_VALUE_LENGTH || r.value.includes("\0")) {
      throw new Error("Browser fill value is required and must be a bounded, NUL-free string");
    }
  } else if (r.value !== undefined) {
    throw new Error("Browser command value is only accepted for fill");
  }
  if (r.timeoutMs !== undefined && (!Number.isSafeInteger(r.timeoutMs) || (r.timeoutMs as number) <= 0)) {
    throw new Error("Browser command timeout must be a positive safe integer");
  }
}
