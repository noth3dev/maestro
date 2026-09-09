import type { ActionRequest } from "@maestro/authority";
import { createAuthorizedFileEditPort, createAuthorizedReadOnlyFilePort, createLocalRuntimeAdapter, type ReadOnlyFileAuthorityGateway } from "@maestro/environment-adapter";
import { createLocalGitPort } from "@maestro/git-adapter";
import type { EnvironmentExecutionPort, EnvironmentRecord } from "@maestro/domain";
import {
  createIpPythonGitRevisionAdapter,
  createIpPythonOwnedProcessChannel,
  createIpPythonProcessKernel,
  createIpPythonLocalEffectsGateway,
  createIpPythonReadOnlyGateway,
  createReadOnlyHostRequestHandler,
  createLocalHostRequestHandler,
  type IpPythonHostBinding,
  type IpPythonKernel,
  type IpPythonRunCommandRequest,
  type IpPythonProcessOrphanedEvent,
  type IpPythonProcessStartedEvent,
} from "@maestro/agent-runtime";

export interface IpPythonProductionCompositionOptions {
  readonly authority: ReadOnlyFileAuthorityGateway;
  readonly workspaceRoot: string;
  readonly pythonExecutable: string;
  readonly processRef?: string;
  /** Optional task-scoped local environment. Its adapters are composed here, never injected by Python. */
  readonly localEnvironment?: EnvironmentRecord;
  readonly onStarted?: (event: IpPythonProcessStartedEvent) => void | Promise<void>;
  readonly onLifecycle?: (event: IpPythonProcessOrphanedEvent) => void | Promise<void>;
}

function authorityContext(binding: IpPythonHostBinding): Omit<ActionRequest, "action" | "target"> {
  if ([binding.commandId, binding.operatorId, binding.projectId, binding.goalId, binding.controlEpoch].some((value) => value.trim() === "")) throw new Error("IPython authority context is incomplete");
  if (!Number.isSafeInteger(binding.authorityPolicyVersion) || binding.authorityPolicyVersion < 0) throw new Error("IPython authority policy version is invalid");
  if (!Number.isSafeInteger(binding.budgetEffectCents) || binding.budgetEffectCents < 0) throw new Error("IPython authority budget is invalid");
  return {
    commandId: binding.commandId,
    projectId: binding.projectId,
    actorId: binding.operatorId,
    goalId: binding.goalId,
    policyVersion: binding.authorityPolicyVersion,
    budgetEffectCents: binding.budgetEffectCents,
    controlEpoch: binding.controlEpoch,
  };
}

function result(state: "ok" | "error" | "unknown" | "cancelled", content: string, reason?: string) {
  return { state, dataClass: "workspace" as const, content, ...(reason === undefined ? {} : { reason }) };
}

function environmentRequest(request: IpPythonRunCommandRequest, target: string) {
  return {
    commandId: request.binding.commandId,
    actorId: request.binding.operatorId,
    action: request.action,
    target,
    policyVersion: request.binding.authorityPolicyVersion,
    budgetEffectCents: request.binding.budgetEffectCents,
    controlEpoch: request.binding.controlEpoch,
    argv: request.argv,
    cwd: request.cwd,
    ...(request.environment === undefined ? {} : { environment: request.environment }),
    ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
    ...(request.outputCapBytes === undefined ? {} : { outputCapBytes: request.outputCapBytes }),
  };
}

async function observeEnvironment(runtime: EnvironmentExecutionPort, request: { readonly commandId: string; readonly actorId: string; readonly action: string; readonly target: string; readonly policyVersion: number; readonly budgetEffectCents: number; readonly controlEpoch: string; readonly argv: readonly string[]; readonly cwd: string; readonly environment?: Readonly<Record<string, string>>; readonly timeoutMs?: number; readonly outputCapBytes?: number }) {
  const handle = await runtime.start(request);
  const deadline = Date.now() + Math.min(request.timeoutMs ?? 30_000, 60_000);
  for (;;) {
    const observed = await handle.observe();
    if (observed.status !== "running") {
      const content = [observed.stdout, observed.stderr].filter(Boolean).join("\n");
      if (observed.status === "succeeded") return result("ok", content, undefined);
      if (observed.status === "cancelled") return result("cancelled", content, observed.status);
      if (observed.status === "timed_out" || observed.status === "output_limit_exceeded") return result("unknown", content, observed.status);
      return result("error", content, observed.error ?? observed.status);
    }
    if (Date.now() >= deadline) {
      await handle.cancel("host_wait_timeout");
      return result("unknown", "Environment process outcome is unknown after host wait timeout", "cancellation_outcome_unknown");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function createLocalEffects(options: { readonly authority: ReadOnlyFileAuthorityGateway; readonly workspaceRoot: string; readonly environment: EnvironmentRecord }, binding: IpPythonHostBinding) {
  const context = authorityContext(binding);
  const file = createAuthorizedFileEditPort({ authority: options.authority, context, workspaceRoot: options.workspaceRoot, pathScope: binding.pathScope });
  const git = createLocalGitPort({ authority: options.authority, context, workspaceRoot: options.workspaceRoot });
  const runtime = createLocalRuntimeAdapter(options.environment, options.authority);
  const safe = async <T>(work: () => Promise<T>, format: (value: T) => string) => {
    try { return result("ok", format(await work())); }
    catch (error) { return result("error", error instanceof Error ? error.message : String(error), "authority_or_boundary_rejected"); }
  };
  return createIpPythonLocalEffectsGateway({ adapters: {
    writeFile: (request) => safe(() => file.writeFile(request.path, request.content), () => "file written"),
    runTest: (request) => observeEnvironment(runtime, environmentRequest(request, JSON.stringify([request.cwd, request.argv]))),
    runShell: (request) => observeEnvironment(runtime, environmentRequest(request, JSON.stringify([request.cwd, request.argv]))),
    runEnvironment: (request) => observeEnvironment(runtime, environmentRequest(request, JSON.stringify([request.cwd, request.argv]))),
    gitCreateBranch: (request) => safe(() => git.createBranch(options.workspaceRoot, request.branchName, request.baseRevision), () => "branch created"),
    gitCreateWorktree: (request) => safe(() => git.createWorktree(options.workspaceRoot, request.worktreePath, request.branchName), () => "worktree created"),
    gitCommit: (request) => safe(() => git.commit(request.worktreePath, request.message, request.authorName, request.authorEmail), (value) => value.commitSha),
    gitAdvanceBranch: (request) => safe(() => git.advanceBranch(options.workspaceRoot, request.branchName, request.expectedRevision, request.targetRevision), () => "branch advanced"),
    gitRemoveWorktree: (request) => safe(() => git.removeWorktree(options.workspaceRoot, request.worktreePath), () => "worktree removed"),
  } });
}

/** Compose the production read-only host bridge; no raw I/O is exposed to Python. */
export function createIpPythonProductionKernel(
  options: IpPythonProductionCompositionOptions,
  sessionId: string,
  binding?: IpPythonHostBinding,
): IpPythonKernel {
  if (binding === undefined) throw new Error("IPython production kernel requires an authority binding");
  if (typeof options.workspaceRoot !== "string" || options.workspaceRoot.trim() === "") throw new Error("IPython workspace root is required");
  const gateway = createIpPythonReadOnlyGateway({
    readFile: async (currentBinding, relativePath) => createAuthorizedReadOnlyFilePort({
      authority: options.authority,
      context: authorityContext(currentBinding),
      workspaceRoot: options.workspaceRoot,
      pathScope: currentBinding.pathScope,
    }).readFile(relativePath),
    gitRevision: async (currentBinding, ref) => createIpPythonGitRevisionAdapter({
      git: createLocalGitPort({ authority: options.authority, context: authorityContext(currentBinding), workspaceRoot: options.workspaceRoot }),
      repositoryPath: options.workspaceRoot,
      scopeRoot: options.workspaceRoot,
    })(currentBinding, ref),
  });
  const localEffects = options.localEnvironment === undefined ? undefined : createLocalEffects({ authority: options.authority, workspaceRoot: options.workspaceRoot, environment: options.localEnvironment }, binding);
  const hostRequest = localEffects === undefined
    ? createReadOnlyHostRequestHandler({ binding, gateway })
    : createLocalHostRequestHandler({ binding, readOnly: gateway, effects: localEffects });
  const channel = createIpPythonOwnedProcessChannel({
    pythonExecutable: options.pythonExecutable,
    cwd: options.workspaceRoot,
    sessionId,
    projectId: binding.projectId,
    goalId: binding.goalId,
    ...(options.processRef === undefined ? {} : { processRef: options.processRef }),
    ...(options.onStarted === undefined ? {} : { onStarted: options.onStarted }),
    ...(options.onLifecycle === undefined ? {} : { onLifecycle: options.onLifecycle }),
  });
  return createIpPythonProcessKernel({ createProcess: () => channel, hostRequest }, sessionId, binding);
}
