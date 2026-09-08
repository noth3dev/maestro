import type { ToolContext, ToolDefinition } from "./agent-runtime.js";
import type { ToolResultStatus } from "./model-provider.js";

const MAX_CODE_BYTES = 64_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;
const MAX_RESULT_BYTES = 64_000;

export interface IpPythonSessionBinding {
  readonly sessionId: string;
  readonly commandId: string;
  readonly toolCallId: string;
  readonly operatorId: string;
  readonly projectId: string;
  readonly goalId: string;
  readonly pathScope: readonly string[];
  readonly outboundDataClasses: readonly string[];
}

export interface IpPythonExecutionRequest {
  readonly sessionId: string;
  readonly code: string;
  readonly binding?: IpPythonSessionBinding;
}

export type IpPythonExecutionState = "ok" | "error" | "cancelled" | "unknown";

export interface IpPythonExecutionResult {
  readonly state: IpPythonExecutionState;
  readonly content: string;
  readonly dataClass: "public" | "workspace" | "private" | "pii" | "phi" | "secret";
  readonly reason?: string;
  readonly truncated?: boolean;
}

export interface IpPythonKernel {
  execute(request: IpPythonExecutionRequest): Promise<IpPythonExecutionResult>;
  interrupt?(sessionId: string): Promise<void>;
  close?(): Promise<void>;
}

export interface IpPythonSessionManager {
  execute(request: IpPythonExecutionRequest): Promise<IpPythonExecutionResult>;
  interrupt(sessionId: string): Promise<void>;
  close(): Promise<void>;
}

export interface IpPythonSessionManagerOptions {
  /** A new kernel is required for every Goal-bound session. */
  readonly createKernel: (sessionId: string, binding?: IpPythonSessionBinding) => IpPythonKernel | Promise<IpPythonKernel>;
  readonly shutdownTimeoutMs?: number;
}

function assertSessionId(sessionId: string): void {
  if (sessionId.trim() === "") throw new Error("IPython session identity is required");
}

function parseCode(value: unknown): { code: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("ipython input must be an object");
  const code = (value as { code?: unknown }).code;
  if (typeof code !== "string" || code.trim() === "") throw new Error("ipython code is required");
  if (Buffer.byteLength(code, "utf8") > MAX_CODE_BYTES) throw new Error("ipython code exceeds the input limit");
  return { code };
}

function parseResult(value: unknown): IpPythonExecutionResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("ipython result must be an object");
  const state = (value as { state?: unknown }).state;
  const content = (value as { content?: unknown }).content;
  const dataClass = (value as { dataClass?: unknown }).dataClass;
  const reason = (value as { reason?: unknown }).reason;
  const truncated = (value as { truncated?: unknown }).truncated;
  if (!(["ok", "error", "cancelled", "unknown"] as const).includes(state as IpPythonExecutionState) || typeof content !== "string") throw new Error("ipython result is invalid");
  if (!["public", "workspace", "private", "pii", "phi", "secret"].includes(dataClass as string)) throw new Error("ipython result data class is invalid");
  if (reason !== undefined && typeof reason !== "string") throw new Error("ipython result reason is invalid");
  if (truncated !== undefined && typeof truncated !== "boolean") throw new Error("ipython result truncation flag is invalid");
  return { state: state as IpPythonExecutionState, content, dataClass: dataClass as IpPythonExecutionResult["dataClass"], ...(reason === undefined ? {} : { reason }), ...(truncated === undefined ? {} : { truncated }) };
}

function boundedContent(content: string): { content: string; truncated: boolean } {
  if (Buffer.byteLength(content, "utf8") <= MAX_RESULT_BYTES) return { content, truncated: false };
  let end = content.length;
  while (end > 0 && Buffer.byteLength(content.slice(0, end), "utf8") > MAX_RESULT_BYTES) end -= 1;
  return { content: content.slice(0, end), truncated: true };
}

function parseToolExecutionResult(value: unknown): { status: ToolResultStatus; content: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("ipython tool result must be an object");
  const status = (value as { status?: unknown }).status;
  const content = (value as { content?: unknown }).content;
  if (!["ok", "error", "unknown"].includes(status as string) || typeof content !== "string") throw new Error("ipython tool result is invalid");
  return { status: status as ToolResultStatus, content };
}

function toolResult(result: IpPythonExecutionResult, context?: ToolContext): { status: ToolResultStatus; content: string } {
  const parsed = parseResult(result);
  if (context !== undefined && !context.capabilityGrant.outboundDataClasses.includes(parsed.dataClass)) throw new Error("IPython result data class is outside the invocation grant");
  const bounded = boundedContent(parsed.content);
  return {
    status: parsed.state === "ok" && !bounded.truncated ? "ok" : parsed.state === "unknown" || parsed.state === "cancelled" || bounded.truncated ? "unknown" : "error",
    content: bounded.content,
  };
}

export function createUnavailableIpPythonKernel(reason = "IPython host runtime is not configured"): IpPythonKernel {
  return {
    async execute() { return { state: "unknown", content: reason, dataClass: "workspace", reason }; },
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); resolve(undefined); });
  });
}

export function createIpPythonSessionManager(options: IpPythonSessionManagerOptions): IpPythonSessionManager {
  const sessions = new Map<string, { readonly kernel: Promise<IpPythonKernel>; readonly binding?: IpPythonSessionBinding; queue: Promise<void> }>();
  let closed = false;

  function sessionFor(sessionId: string, binding?: IpPythonSessionBinding): { readonly kernel: Promise<IpPythonKernel>; readonly binding?: IpPythonSessionBinding; queue: Promise<void> } {
    assertSessionId(sessionId);
    if (binding !== undefined && binding.sessionId !== sessionId) throw new Error("IPython session binding identity mismatch");
    const existing = sessions.get(sessionId);
    if (existing !== undefined) {
      if (sessionBindingKey(existing.binding) !== sessionBindingKey(binding)) throw new Error("IPython session binding changed");
      return existing;
    }
    const session = { kernel: Promise.resolve(options.createKernel(sessionId, binding)), ...(binding === undefined ? {} : { binding }), queue: Promise.resolve() };
    sessions.set(sessionId, session);
    return session;
  }

  return {
    execute(request) {
      if (closed) return Promise.reject(new Error("IPython session manager is closed"));
      let session: { readonly kernel: Promise<IpPythonKernel>; readonly binding?: IpPythonSessionBinding; queue: Promise<void> };
      try { session = sessionFor(request.sessionId, request.binding); } catch (error) { return Promise.reject(error); }
      const run = session.queue.then(async () => (await session.kernel).execute(request));
      session.queue = run.then(() => undefined, () => undefined);
      return run;
    },
    async interrupt(sessionId) {
      const session = sessions.get(sessionId);
      if (session === undefined) return;
      const kernel = await session.kernel;
      await kernel.interrupt?.(sessionId);
    },
    async close() {
      if (closed) return;
      closed = true;
      const timeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
      const active = [...sessions.values()];
      await withTimeout(Promise.all(active.map((session) => session.queue)), timeoutMs);
      await withTimeout(Promise.all(active.map(async (session) => (await session.kernel).close?.())), timeoutMs);
      sessions.clear();
    },
  };
}

function sessionIdFor(context: ToolContext): string {
  for (const [value, label] of [[context.commandId, "command identity"], [context.toolCallId, "tool-call identity"], [context.operatorId, "operator identity"]] as const) {
    if (typeof value !== "string" || value.trim() === "") throw new Error(`IPython tool requires ${label}`);
  }
  const parts = [context.projectId, context.goalId, context.conversationId];
  if (parts.some((part) => part.trim() === "")) throw new Error("IPython tool requires project, Goal, and conversation identity");
  return JSON.stringify(parts);
}

function sessionBindingKey(binding: IpPythonSessionBinding | undefined): string {
  if (binding === undefined) return "undefined";
  const { commandId: _commandId, toolCallId: _toolCallId, ...stableBinding } = binding;
  return JSON.stringify(stableBinding);
}

export function createIpPythonTool(options: { sessions: IpPythonSessionManager }): ToolDefinition {
  return {
    name: "ipython",
    version: "1",
    description: "Execute bounded Python in the current Goal-bound persistent session.",
    inputSchema: { parse: parseCode },
    outputSchema: { parse: parseToolExecutionResult },
    modelInputSchema: {
      type: "object",
      additionalProperties: false,
      description: "Code is limited to 64000 UTF-8 bytes by the host.",
      properties: { code: { type: "string", minLength: 1 } },
      required: ["code"],
    },
    allowsParallel: false,
    outboundDataClass: "workspace",
    async execute(args, context) {
      const { code } = parseCode(args);
      const sessionId = sessionIdFor(context);
      return toolResult(await options.sessions.execute({ sessionId, code, binding: { sessionId, commandId: context.commandId, toolCallId: context.toolCallId, operatorId: context.operatorId, projectId: context.projectId, goalId: context.goalId, pathScope: context.capabilityGrant.pathScope, outboundDataClasses: context.capabilityGrant.outboundDataClasses } }), context);
    },
  };
}
