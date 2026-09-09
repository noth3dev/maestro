import type { IpPythonExecutionResult } from "./ipython-tool.js";
import type { IpPythonHostBinding, IpPythonHostRequest, IpPythonReadOnlyGateway } from "./ipython-host.js";
import { createReadOnlyHostRequestHandler, IpPythonProtocolError } from "./ipython-host.js";

export type IpPythonLocalEffectMethod =
  | "write_file"
  | "run_command"
  | "git_create_branch"
  | "git_create_worktree"
  | "git_commit"
  | "git_advance_branch"
  | "git_remove_worktree";

export interface IpPythonLocalEffectRequest {
  readonly method: string;
  readonly payload: unknown;
}

export interface IpPythonWriteFileRequest {
  readonly binding: IpPythonHostBinding;
  readonly path: string;
  readonly content: string;
}

export interface IpPythonRunCommandRequest {
  readonly binding: IpPythonHostBinding;
  readonly action: string;
  readonly target: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly outputCapBytes?: number;
}

export interface IpPythonGitCreateBranchRequest {
  readonly binding: IpPythonHostBinding;
  readonly branchName: string;
  readonly baseRevision: string;
}

export interface IpPythonGitCreateWorktreeRequest {
  readonly binding: IpPythonHostBinding;
  readonly worktreePath: string;
  readonly branchName: string;
}

export interface IpPythonGitCommitRequest {
  readonly binding: IpPythonHostBinding;
  readonly worktreePath: string;
  readonly message: string;
  readonly authorName: string;
  readonly authorEmail: string;
}

export interface IpPythonGitAdvanceBranchRequest {
  readonly binding: IpPythonHostBinding;
  readonly branchName: string;
  readonly expectedRevision: string;
  readonly targetRevision: string;
}

export interface IpPythonGitRemoveWorktreeRequest {
  readonly binding: IpPythonHostBinding;
  readonly worktreePath: string;
}

export interface IpPythonLocalEffectAdapters {
  writeFile(request: IpPythonWriteFileRequest): IpPythonExecutionResult | Promise<IpPythonExecutionResult>;
  runCommand(request: IpPythonRunCommandRequest): IpPythonExecutionResult | Promise<IpPythonExecutionResult>;
  gitCreateBranch(request: IpPythonGitCreateBranchRequest): IpPythonExecutionResult | Promise<IpPythonExecutionResult>;
  gitCreateWorktree(request: IpPythonGitCreateWorktreeRequest): IpPythonExecutionResult | Promise<IpPythonExecutionResult>;
  gitCommit(request: IpPythonGitCommitRequest): IpPythonExecutionResult | Promise<IpPythonExecutionResult>;
  gitAdvanceBranch(request: IpPythonGitAdvanceBranchRequest): IpPythonExecutionResult | Promise<IpPythonExecutionResult>;
  gitRemoveWorktree(request: IpPythonGitRemoveWorktreeRequest): IpPythonExecutionResult | Promise<IpPythonExecutionResult>;
}

export interface IpPythonLocalEffectsGateway {
  handle(binding: IpPythonHostBinding, request: IpPythonLocalEffectRequest): Promise<IpPythonExecutionResult>;
}

function payloadRecord(payload: unknown): Record<string, unknown> {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) throw new IpPythonProtocolError("IPython local effect payload must be an object");
  return payload as Record<string, unknown>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\0")) throw new IpPythonProtocolError(`IPython local effect ${name} is required`);
  return value;
}

function relativePath(value: unknown): string {
  const path = requiredString(value, "path");
  if (path.includes("\\") || path.startsWith("/") || path.split("/").some((part) => part === "..")) throw new IpPythonProtocolError("IPython local effect path is outside the Goal scope");
  return path;
}

function absolutePath(value: unknown, name: string): string {
  const path = requiredString(value, name);
  if (!path.startsWith("/") || path.includes("\0")) throw new IpPythonProtocolError(`IPython local effect ${name} must be an absolute path`);
  return path;
}

function stringList(value: unknown, name: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((part) => typeof part !== "string" || part.trim() === "" || part.includes("\0"))) throw new IpPythonProtocolError(`IPython local effect ${name} must be a command array`);
  return value;
}

function safeEnvironment(value: unknown): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new IpPythonProtocolError("IPython local effect environment must be an object");
  const environment: Record<string, string> = {};
  for (const [name, entry] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof entry !== "string" || entry.includes("\0")) throw new IpPythonProtocolError("IPython local effect environment contains an invalid variable");
    environment[name] = entry;
  }
  return environment;
}

function boundedNumber(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new IpPythonProtocolError(`IPython local effect ${name} is invalid`);
  return value as number;
}

function safeCommand(payload: Record<string, unknown>, binding: IpPythonHostBinding): IpPythonRunCommandRequest {
  const argv = stringList(payload.argv, "argv");
  const executable = argv[0]!.split(/[\\/]/).at(-1)!.toLowerCase();
  if (["sh", "bash", "zsh", "fish", "cmd", "powershell", "pwsh"].includes(executable)) throw new IpPythonProtocolError("IPython local effect command shell is not allowed");
  const action = requiredString(payload.action, "action");
  const target = requiredString(payload.target, "target");
  return {
    binding,
    action,
    target,
    argv,
    cwd: absolutePath(payload.cwd, "cwd"),
    ...(payload.environment === undefined ? {} : { environment: safeEnvironment(payload.environment)! }),
    ...(payload.timeoutMs === undefined ? {} : { timeoutMs: boundedNumber(payload.timeoutMs, "timeoutMs")! }),
    ...(payload.outputCapBytes === undefined ? {} : { outputCapBytes: boundedNumber(payload.outputCapBytes, "outputCapBytes")! }),
  };
}

function sameBinding(left: IpPythonHostBinding, right: IpPythonHostBinding): boolean {
  const stable = (value: IpPythonHostBinding) => {
    const { commandId: _commandId, toolCallId: _toolCallId, ...rest } = value;
    return JSON.stringify(rest);
  };
  return stable(left) === stable(right);
}

export function createIpPythonLocalEffectsGateway(options: { adapters: IpPythonLocalEffectAdapters }): IpPythonLocalEffectsGateway {
  return {
    async handle(binding, request) {
      const payload = payloadRecord(request.payload);
      switch (request.method as IpPythonLocalEffectMethod) {
        case "write_file":
          return options.adapters.writeFile({ binding, path: relativePath(payload.path), content: requiredString(payload.content, "content") });
        case "run_command":
          return options.adapters.runCommand(safeCommand(payload, binding));
        case "git_create_branch":
          return options.adapters.gitCreateBranch({ binding, branchName: requiredString(payload.branchName, "branchName"), baseRevision: requiredString(payload.baseRevision, "baseRevision") });
        case "git_create_worktree":
          return options.adapters.gitCreateWorktree({ binding, worktreePath: absolutePath(payload.worktreePath, "worktreePath"), branchName: requiredString(payload.branchName, "branchName") });
        case "git_commit":
          return options.adapters.gitCommit({ binding, worktreePath: absolutePath(payload.worktreePath, "worktreePath"), message: requiredString(payload.message, "message"), authorName: requiredString(payload.authorName, "authorName"), authorEmail: requiredString(payload.authorEmail, "authorEmail") });
        case "git_advance_branch":
          return options.adapters.gitAdvanceBranch({ binding, branchName: requiredString(payload.branchName, "branchName"), expectedRevision: requiredString(payload.expectedRevision, "expectedRevision"), targetRevision: requiredString(payload.targetRevision, "targetRevision") });
        case "git_remove_worktree":
          return options.adapters.gitRemoveWorktree({ binding, worktreePath: absolutePath(payload.worktreePath, "worktreePath") });
        default:
          throw new IpPythonProtocolError(`IPython local effect method is not allowed: ${request.method}`);
      }
    },
  };
}

export function createLocalHostRequestHandler(options: { readonly binding: IpPythonHostBinding; readonly readOnly: IpPythonReadOnlyGateway; readonly effects: IpPythonLocalEffectsGateway }): (request: IpPythonHostRequest, binding?: IpPythonHostBinding) => Promise<IpPythonExecutionResult> {
  const readOnly = createReadOnlyHostRequestHandler({ binding: options.binding, gateway: options.readOnly });
  return async (request, requestBinding) => {
    const binding = requestBinding ?? options.binding;
    if (!sameBinding(binding, options.binding)) throw new IpPythonProtocolError("IPython host binding identity changed");
    if (request.method === "read_file" || request.method === "git_revision") return readOnly(request, binding);
    const result = await options.effects.handle(binding, request);
    if (!options.binding.outboundDataClasses.includes(result.dataClass)) throw new IpPythonProtocolError("IPython local effect result is outside the Goal scope");
    if (!["ok", "error", "cancelled", "unknown"].includes(result.state) || typeof result.content !== "string") throw new IpPythonProtocolError("IPython local effect result is invalid");
    return result;
  };
}
