import {
  createIpPythonOwnedProcessChannel,
  createIpPythonProcessKernel,
  createIpPythonSessionManager,
  ToolRegistry,
  type IpPythonExecutionResult,
  type IpPythonKernel,
  type IpPythonLineChannel,
  type IpPythonSessionBinding,
  type IpPythonSessionManager,
  type ToolContext,
  type ToolDefinition,
} from "@maestro/agent-runtime";
import type { IpPythonHostRequest } from "@maestro/agent-runtime";
import type { SessionWorkspace } from "./session-workspace.js";

/** What a role may do in its conversation's session workspace. */
export type SessionIpPythonAccess = "read" | "write";

export interface SessionIpPythonScope {
  readonly projectId: string;
  readonly conversationId: string;
  readonly access: SessionIpPythonAccess;
}

export interface SessionIpPython {
  /** A registry holding the single `ipython` tool bound to one conversation. */
  tools(scope: SessionIpPythonScope): ToolRegistry;
  close(): Promise<void>;
}

const MAX_CODE_BYTES = 64_000;
const MAX_RESULT_BYTES = 64_000;
const DEFAULT_IDLE_MS = 10 * 60_000;

function parseCode(value: unknown): { code: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("ipython input must be an object");
  const code = (value as { code?: unknown }).code;
  if (typeof code !== "string" || code.trim() === "") throw new Error("ipython code is required");
  if (Buffer.byteLength(code, "utf8") > MAX_CODE_BYTES) throw new Error("ipython code exceeds the input limit");
  return { code };
}

function parseToolResult(value: unknown): { status: "ok" | "error" | "unknown"; content: string } {
  const status = (value as { status?: unknown } | null)?.status;
  const content = (value as { content?: unknown } | null)?.content;
  if (!["ok", "error", "unknown"].includes(status as string) || typeof content !== "string") throw new Error("ipython tool result is invalid");
  return { status: status as "ok" | "error" | "unknown", content };
}

function stringField(payload: unknown, name: string): string {
  const value = payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>)[name] : undefined;
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  return value;
}

/**
 * Host functions for a session-scoped IPython kernel. They act only on the
 * conversation's own Git workspace; everything else (shell, tests, Git
 * branches, network) is unavailable here and fails with a readable error.
 */
export function createSessionHostRequestHandler(options: {
  readonly workspace: SessionWorkspace;
  readonly scope: SessionIpPythonScope;
  readonly onWrite?: (write: { path: string; revision: string | null }) => void;
}): (request: IpPythonHostRequest) => Promise<IpPythonExecutionResult> {
  const { workspace, scope } = options;
  const ok = (content: string): IpPythonExecutionResult => ({ state: "ok", dataClass: "workspace", content });
  return async (request) => {
    if (request.method === "read_file") {
      return ok((await workspace.read(scope.projectId, scope.conversationId, stringField(request.payload, "path"))).content);
    }
    if (request.method === "list_files") {
      const prefix = stringField(request.payload, "path").replace(/^\/+/, "");
      const listing = await workspace.list(scope.projectId, scope.conversationId);
      return ok(listing.files.map((file) => file.path).filter((path) => prefix === "" || path.startsWith(prefix)).join("\n"));
    }
    if (request.method === "write_file") {
      if (scope.access !== "write") throw new Error("This role can only read the session workspace");
      const path = stringField(request.payload, "path");
      const content = stringField(request.payload, "content");
      const result = await workspace.write(scope.projectId, scope.conversationId, [{ path, content }], `Update ${path}`);
      options.onWrite?.({ path, revision: result.revision });
      return ok(`wrote ${path}${result.revision === null ? "" : ` at ${result.revision.slice(0, 12)}`}`);
    }
    throw new Error(`${request.method} is not available in a session workspace`);
  };
}

function toolDescription(access: SessionIpPythonAccess): string {
  const helpers =
    access === "write"
      ? "list_files(prefix='') returns newline-separated paths, read_file(path) returns text, write_file(path, content) replaces a whole file and records a commit"
      : "list_files(prefix='') returns newline-separated paths and read_file(path) returns text; this role cannot write";
  return `Run Python in this conversation's persistent session. Direct I/O and imports are blocked; use the host helpers: ${helpers}. Paths are relative to the session workspace, e.g. plan00.md or design/home.canvas.`;
}

/**
 * Session-scoped IPython: one persistent kernel per conversation and access
 * level, stopped after it has been idle, exposed to models as `ipython`.
 */
export function createSessionIpPython(options: {
  readonly workspace: SessionWorkspace;
  readonly pythonExecutable: string;
  /** Working directory for the Python child; it never receives file access. */
  readonly cwd: string;
  readonly idleMs?: number;
  /** Test seam; production spawns the owned Python child. */
  readonly createChannel?: (sessionId: string) => IpPythonLineChannel;
}): SessionIpPython {
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const managers = new Map<string, { manager: IpPythonSessionManager; timer?: ReturnType<typeof setTimeout> }>();

  const managerFor = (scope: SessionIpPythonScope, sessionId: string) => {
    let entry = managers.get(sessionId);
    if (entry === undefined) {
      const hostRequest = createSessionHostRequestHandler({ workspace: options.workspace, scope });
      const manager = createIpPythonSessionManager({
        createKernel: (id, binding): IpPythonKernel =>
          createIpPythonProcessKernel(
            {
              createProcess: () =>
                options.createChannel?.(id) ??
                createIpPythonOwnedProcessChannel({
                  pythonExecutable: options.pythonExecutable,
                  cwd: options.cwd,
                  sessionId: id,
                  projectId: scope.projectId,
                  goalId: `session-${scope.conversationId}`,
                }),
              hostRequest: (request) => hostRequest(request),
            },
            id,
            binding,
          ),
      });
      entry = { manager };
      managers.set(sessionId, entry);
    }
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    const current = entry;
    current.timer = setTimeout(() => {
      managers.delete(sessionId);
      void current.manager.close().catch(() => undefined);
    }, idleMs);
    current.timer.unref?.();
    return current.manager;
  };

  return {
    tools(scope) {
      const sessionId = `session:${scope.access}:${scope.conversationId}`;
      const tool: ToolDefinition = {
        name: "ipython",
        version: "1",
        description: toolDescription(scope.access),
        inputSchema: { parse: parseCode },
        outputSchema: { parse: parseToolResult },
        modelInputSchema: {
          type: "object",
          additionalProperties: false,
          description: "Code is limited to 64000 UTF-8 bytes by the host.",
          properties: { code: { type: "string", minLength: 1 } },
          required: ["code"],
        },
        allowsParallel: false,
        outboundDataClass: "workspace",
        async execute(args, context: ToolContext) {
          const { code } = parseCode(args);
          const binding: IpPythonSessionBinding = {
            sessionId,
            commandId: context.commandId,
            toolCallId: context.toolCallId,
            operatorId: context.operatorId,
            projectId: scope.projectId,
            goalId: `session-${scope.conversationId}`,
            pathScope: [],
            outboundDataClasses: ["public", "workspace"],
            authorityPolicyVersion: 0,
            controlEpoch: "session",
            budgetEffectCents: 0,
          };
          const result = await managerFor(scope, sessionId).execute({ sessionId, code, binding });
          const content = Buffer.byteLength(result.content, "utf8") > MAX_RESULT_BYTES ? `${result.content.slice(0, MAX_RESULT_BYTES)}\n… (truncated)` : result.content;
          return { status: result.state === "ok" ? "ok" : result.state === "error" ? "error" : "unknown", content };
        },
      };
      const registry = new ToolRegistry();
      registry.register(tool);
      return registry;
    },
    async close() {
      const entries = [...managers.values()];
      managers.clear();
      for (const entry of entries) if (entry.timer !== undefined) clearTimeout(entry.timer);
      await Promise.all(entries.map((entry) => entry.manager.close().catch(() => undefined)));
    },
  };
}
