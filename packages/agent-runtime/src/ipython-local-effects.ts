import { realpathSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import type { IpPythonExecutionResult } from "./ipython-tool.js";
import type { IpPythonHostBinding, IpPythonHostRequest, IpPythonReadOnlyGateway } from "./ipython-host.js";
import { createReadOnlyHostRequestHandler, IpPythonProtocolError } from "./ipython-host.js";

export type IpPythonLocalEffectMethod =
  | "write_file"
  | "run_test"
  | "run_shell"
  | "run_environment"
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
  readonly pathScope: readonly string[];
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
  runTest(request: IpPythonRunCommandRequest): IpPythonExecutionResult | Promise<IpPythonExecutionResult>;
  runShell(request: IpPythonRunCommandRequest): IpPythonExecutionResult | Promise<IpPythonExecutionResult>;
  runEnvironment(request: IpPythonRunCommandRequest): IpPythonExecutionResult | Promise<IpPythonExecutionResult>;
  gitCreateBranch(request: IpPythonGitCreateBranchRequest): IpPythonExecutionResult | Promise<IpPythonExecutionResult>;
  gitCreateWorktree(request: IpPythonGitCreateWorktreeRequest): IpPythonExecutionResult | Promise<IpPythonExecutionResult>;
  gitCommit(request: IpPythonGitCommitRequest): IpPythonExecutionResult | Promise<IpPythonExecutionResult>;
  gitAdvanceBranch(request: IpPythonGitAdvanceBranchRequest): IpPythonExecutionResult | Promise<IpPythonExecutionResult>;
  gitRemoveWorktree(request: IpPythonGitRemoveWorktreeRequest): IpPythonExecutionResult | Promise<IpPythonExecutionResult>;
}

export interface IpPythonPreparedLocalEffect {
  readonly result: IpPythonExecutionResult;
  readonly commit: () => Promise<IpPythonExecutionResult>;
  readonly rollback: () => void | Promise<void>;
}

export interface IpPythonLocalEffectsGateway {
  handle(binding: IpPythonHostBinding, request: IpPythonLocalEffectRequest): Promise<IpPythonExecutionResult>;
  prepare(binding: IpPythonHostBinding, request: IpPythonLocalEffectRequest): Promise<IpPythonPreparedLocalEffect>;
}

function payloadRecord(payload: unknown): Record<string, unknown> {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) throw new IpPythonProtocolError("IPython local effect payload must be an object");
  return payload as Record<string, unknown>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\0")) throw new IpPythonProtocolError(`IPython local effect ${name} is required`);
  return value;
}

function textValue(value: unknown, name: string): string {
  if (typeof value !== "string" || value.includes("\0")) throw new IpPythonProtocolError(`IPython local effect ${name} must be text`);
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

function canonicalForScope(path: string): string {
  let candidate = resolve(path);
  const missing: string[] = [];
  while (true) {
    try { return missing.length === 0 ? realpathSync.native(candidate) : resolve(realpathSync.native(candidate), ...missing); }
    catch {
      const parent = dirname(candidate);
      if (parent === candidate) return resolve(path);
      missing.unshift(basename(candidate));
      candidate = parent;
    }
  }
}

function assertGoalScopedPath(path: string, binding: IpPythonHostBinding, label: string): string {
  const candidate = canonicalForScope(path);
  if (binding.pathScope.length === 0 || !binding.pathScope.some((scope) => {
    const root = canonicalForScope(scope);
    const remainder = relative(root, candidate);
    return remainder === "" || (!remainder.startsWith(`..${sep}`) && remainder !== "..");
  })) throw new IpPythonProtocolError(`IPython local effect ${label} is outside the Goal path scope`);
  return path;
}

function safeCommand(payload: Record<string, unknown>, binding: IpPythonHostBinding, action: IpPythonRunCommandRequest["action"]): IpPythonRunCommandRequest {
  const argv = stringList(payload.argv, "argv");
  const executable = argv[0]!.split(/[\\/]/).at(-1)!.toLowerCase();
  if (["sh", "bash", "zsh", "fish", "cmd", "powershell", "pwsh", "env", "xargs", "parallel", "find", "busybox", "make", "just", "task", "node", "nodejs", "python", "python3", "perl", "ruby", "php", "java", "dotnet", "go"].includes(executable)) throw new IpPythonProtocolError("IPython local effect command wrapper or interpreter is not allowed");
  if (executable === "git") throw new IpPythonProtocolError("Git operations must use dedicated local Git methods");
  if (["npm", "npx", "pnpm", "yarn", "bun"].includes(executable) && (action !== "project.test.run" || argv.length !== 2 || argv[1] !== "test")) throw new IpPythonProtocolError("IPython package-manager effects are limited to the exact test command");
  const target = requiredString(payload.target, "target");
  const cwd = assertGoalScopedPath(absolutePath(payload.cwd, "cwd"), binding, "cwd");
  for (const argument of argv.slice(1)) {
    if (/(?:^|[/\\=:])\.\.(?:[/\\]|$)/.test(argument)) throw new IpPythonProtocolError("IPython local effect command argument escapes the Goal path scope");
    const absoluteArgument = argument.startsWith("/") ? argument : argument.match(/[=:](\/.*)$/)?.[1];
    if (absoluteArgument !== undefined) assertGoalScopedPath(absoluteArgument, binding, "command argument");
  }
  return {
    binding,
    action,
    target,
    argv,
    cwd,
    pathScope: binding.pathScope,
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
  const operation = (binding: IpPythonHostBinding, request: IpPythonLocalEffectRequest): (() => Promise<IpPythonExecutionResult>) => {
    const payload = payloadRecord(request.payload);
    switch (request.method as IpPythonLocalEffectMethod) {
      case "write_file": {
        const path = relativePath(payload.path);
        const content = textValue(payload.content, "content");
        return () => Promise.resolve(options.adapters.writeFile({ binding, path, content }));
      }
      case "run_test": {
        const command = safeCommand(payload, binding, "project.test.run");
        return () => Promise.resolve(options.adapters.runTest(command));
      }
      case "run_shell": {
        const command = safeCommand(payload, binding, "project.shell.run");
        return () => Promise.resolve(options.adapters.runShell(command));
      }
      case "run_environment": {
        const command = safeCommand(payload, binding, "project.environment.change");
        return () => Promise.resolve(options.adapters.runEnvironment(command));
      }
      case "git_create_branch": {
        const branchName = requiredString(payload.branchName, "branchName");
        const baseRevision = requiredString(payload.baseRevision, "baseRevision");
        return () => Promise.resolve(options.adapters.gitCreateBranch({ binding, branchName, baseRevision }));
      }
      case "git_create_worktree": {
        const worktreePath = absolutePath(payload.worktreePath, "worktreePath");
        const branchName = requiredString(payload.branchName, "branchName");
        return () => Promise.resolve(options.adapters.gitCreateWorktree({ binding, worktreePath, branchName }));
      }
      case "git_commit": {
        const worktreePath = absolutePath(payload.worktreePath, "worktreePath");
        const message = requiredString(payload.message, "message");
        const authorName = requiredString(payload.authorName, "authorName");
        const authorEmail = requiredString(payload.authorEmail, "authorEmail");
        return () => Promise.resolve(options.adapters.gitCommit({ binding, worktreePath, message, authorName, authorEmail }));
      }
      case "git_advance_branch": {
        const branchName = requiredString(payload.branchName, "branchName");
        const expectedRevision = requiredString(payload.expectedRevision, "expectedRevision");
        const targetRevision = requiredString(payload.targetRevision, "targetRevision");
        return () => Promise.resolve(options.adapters.gitAdvanceBranch({ binding, branchName, expectedRevision, targetRevision }));
      }
      case "git_remove_worktree": {
        const worktreePath = absolutePath(payload.worktreePath, "worktreePath");
        return () => Promise.resolve(options.adapters.gitRemoveWorktree({ binding, worktreePath }));
      }
      default:
        throw new IpPythonProtocolError(`IPython local effect method is not allowed: ${request.method}`);
    }
  };
  return {
    async handle(binding, request) { return operation(binding, request)(); },
    async prepare(binding, request) {
      const commit = operation(binding, request);
      return {
        result: { state: "ok", dataClass: "workspace", content: "[effect prepared]" },
        commit,
        rollback: async () => {},
      };
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
