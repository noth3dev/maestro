import type { ActionRequest } from "@maestro/authority";
import { createAuthorizedFileEditPort, createAuthorizedReadOnlyFilePort, createContainerSandboxAdapter, createLocalRuntimeAdapter, type ReadOnlyFileAuthorityGateway } from "@maestro/environment-adapter";
import { createLocalGitPort } from "@maestro/git-adapter";
import type { EnvironmentExecutionPort, EnvironmentRecord } from "@maestro/domain";
import {
  createIpPythonGitRevisionAdapter,
  createIpPythonOwnedProcessChannel,
  createIpPythonProcessKernel,
  createIpPythonTwoStageProcessKernel,
  createIpPythonLocalEffectsGateway,
  createIpPythonReadOnlyGateway,
  createReadOnlyHostRequestHandler,
  createLocalHostRequestHandler,
  type IpPythonHostBinding,
  type IpPythonKernel,
  type IpPythonRunCommandRequest,
  type IpPythonHostRequest,
  type IpPythonPreparedEffect,
  type IpPythonTwoStageExecutionOptions,
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
  /** Required when local effects are enabled; local mutations use collect/approve/commit. */
  readonly twoStage?: Pick<IpPythonTwoStageExecutionOptions, "fencingToken" | "approve" | "isFencingCurrent" | "recordEffectResult" | "recordStageBoundary">;
  readonly readEnvironment?: () => Promise<EnvironmentRecord | undefined>;
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
    pathScope: request.pathScope,
    ...(request.environment === undefined ? {} : { environment: request.environment }),
    ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
    ...(request.outputCapBytes === undefined ? {} : { outputCapBytes: request.outputCapBytes }),
  };
}

async function observeEnvironment(runtime: EnvironmentExecutionPort, request: { readonly commandId: string; readonly actorId: string; readonly action: string; readonly target: string; readonly policyVersion: number; readonly budgetEffectCents: number; readonly controlEpoch: string; readonly argv: readonly string[]; readonly cwd: string; readonly pathScope?: readonly string[]; readonly environment?: Readonly<Record<string, string>>; readonly timeoutMs?: number; readonly outputCapBytes?: number }, onHandle?: (handle: { cancel(reason?: string): Promise<{ cancelled: boolean }>; observe(): Promise<unknown> } | undefined) => void) {
  let handle: Awaited<ReturnType<EnvironmentExecutionPort["start"]>>;
  try { handle = await runtime.start(request); }
  catch (error) {
    const decision = error instanceof Error && "decision" in error ? (error as { decision?: { reason?: string } }).decision : undefined;
    if (decision?.reason === "already_executed") return result("unknown", "Environment command was already claimed; its prior outcome is unknown", "already_executed");
    throw error;
  }
  onHandle?.(handle);
  const deadline = Date.now() + Math.min(request.timeoutMs ?? 30_000, 60_000);
  for (;;) {
    const observed = await handle.observe();
    if (observed.status !== "running") {
      const content = [observed.stdout, observed.stderr].filter(Boolean).join("\n");
      onHandle?.(undefined);
      if (observed.status === "succeeded") return result("ok", content, undefined);
      if (observed.status === "cancelled") return result("cancelled", content, observed.status);
      if (observed.status === "timed_out" || observed.status === "output_limit_exceeded") return result("unknown", content, observed.status);
      return result("error", content, observed.error ?? observed.status);
    }
    if (Date.now() >= deadline) {
      await handle.cancel("host_wait_timeout");
      onHandle?.(undefined);
      return result("unknown", "Environment process outcome is unknown after host wait timeout", "cancellation_outcome_unknown");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function createLocalEffects(options: { readonly authority: ReadOnlyFileAuthorityGateway; readonly workspaceRoot: string; readonly environment: EnvironmentRecord; readonly readEnvironment?: () => Promise<EnvironmentRecord | undefined>; readonly onHandle?: (handle: { cancel(reason?: string): Promise<{ cancelled: boolean }>; observe(): Promise<unknown> } | undefined) => void }) {
  const runtimeFactory = options.environment.type === "container_sandbox" ? createContainerSandboxAdapter : createLocalRuntimeAdapter;
  const runtime = runtimeFactory(options.environment, options.authority, { ...(options.readEnvironment === undefined ? {} : { readEnvironment: options.readEnvironment }) });
  const filePort = (currentBinding: IpPythonHostBinding) => createAuthorizedFileEditPort({ authority: options.authority, context: authorityContext(currentBinding), workspaceRoot: options.workspaceRoot, pathScope: currentBinding.pathScope });
  const gitPort = (currentBinding: IpPythonHostBinding) => createLocalGitPort({ authority: options.authority, context: authorityContext(currentBinding), workspaceRoot: options.workspaceRoot, pathScope: currentBinding.pathScope });
  const safe = async <T>(work: () => Promise<T>, format: (value: T) => string) => {
    try { return result("ok", format(await work())); }
    catch (error) {
      const decision = error instanceof Error && "decision" in error ? (error as { decision?: { reason?: string } }).decision : undefined;
      if (decision?.reason === "already_executed") return result("unknown", "Effect was already claimed; its prior outcome is unknown", "already_executed");
      if (error instanceof Error && error.name.endsWith("OutcomeUnknownError")) return result("unknown", error.message, "effect_outcome_unknown");
      return result("error", error instanceof Error ? error.message : String(error), "authority_or_boundary_rejected");
    }
  };
  return createIpPythonLocalEffectsGateway({ adapters: {
    writeFile: (request) => safe(() => filePort(request.binding).writeFile(request.path, request.content), () => "file written"),
    runTest: (request) => observeEnvironment(runtime, environmentRequest(request, JSON.stringify([request.cwd, request.argv])), options.onHandle),
    runShell: (request) => observeEnvironment(runtime, environmentRequest(request, JSON.stringify([request.cwd, request.argv])), options.onHandle),
    runEnvironment: (request) => observeEnvironment(runtime, environmentRequest(request, JSON.stringify([request.cwd, request.argv])), options.onHandle),
    gitCreateBranch: (request) => safe(() => gitPort(request.binding).createBranch(options.workspaceRoot, request.branchName, request.baseRevision), () => "branch created"),
    gitCreateWorktree: (request) => safe(() => gitPort(request.binding).createWorktree(options.workspaceRoot, request.worktreePath, request.branchName), () => "worktree created"),
    gitCommit: (request) => safe(() => gitPort(request.binding).commit(request.worktreePath, request.message, request.authorName, request.authorEmail), (value) => value.commitSha),
    gitAdvanceBranch: (request) => safe(() => gitPort(request.binding).advanceBranch(options.workspaceRoot, request.branchName, request.expectedRevision, request.targetRevision), () => "branch advanced"),
    gitRemoveWorktree: (request) => safe(() => gitPort(request.binding).removeWorktree(options.workspaceRoot, request.worktreePath), () => "worktree removed"),
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
      git: createLocalGitPort({ authority: options.authority, context: authorityContext(currentBinding), workspaceRoot: options.workspaceRoot, pathScope: currentBinding.pathScope }),
      repositoryPath: options.workspaceRoot,
      scopeRoot: options.workspaceRoot,
    })(currentBinding, ref),
  });
  let activeHandle: { cancel(reason?: string): Promise<{ cancelled: boolean }>; observe(): Promise<unknown> } | undefined;
  const localEffects = options.localEnvironment === undefined ? undefined : createLocalEffects({
    authority: options.authority,
    workspaceRoot: options.workspaceRoot,
    environment: options.localEnvironment,
    ...(options.readEnvironment === undefined ? {} : { readEnvironment: options.readEnvironment }),
    onHandle: (handle) => { activeHandle = handle; },
  });
  if (localEffects !== undefined && options.twoStage === undefined) throw new Error("IPython local effects require two-stage execution");
  const readOnlyHostRequest = createReadOnlyHostRequestHandler({ binding, gateway });
  const hostRequest = localEffects === undefined ? readOnlyHostRequest : createLocalHostRequestHandler({ binding, readOnly: gateway, effects: localEffects });
  const prepareEffect = async (request: IpPythonHostRequest, requestBinding?: IpPythonHostBinding): Promise<IpPythonPreparedEffect> => {
    const currentBinding = requestBinding ?? binding;
    if (request.method === "read_file" || request.method === "git_revision") {
      const observed = await readOnlyHostRequest(request, currentBinding);
      return { result: observed, commit: async (lease) => { await lease.assertValid(); return observed; }, rollback: async () => {} };
    }
    if (localEffects === undefined) throw new Error("IPython local effect is not configured");
    const prepared = await localEffects.prepare(currentBinding, { method: request.method, payload: request.payload });
    return { result: prepared.result, commit: async (lease) => { await lease.assertValid(); return prepared.commit(); }, rollback: prepared.rollback };
  };
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
  const kernel = options.twoStage === undefined
    ? createIpPythonProcessKernel({ createProcess: () => channel, hostRequest }, sessionId, binding)
    : createIpPythonTwoStageProcessKernel({
      createProcess: () => channel,
      ...options.twoStage,
      prepareEffect,
    }, sessionId, binding);
  return {
    execute: kernel.execute,
    ...(kernel.interrupt === undefined ? {} : { interrupt: async (currentSessionId: string) => {
      await activeHandle?.cancel("ipython_interrupt");
      await kernel.interrupt?.(currentSessionId);
    } }),
    async close() {
      await activeHandle?.cancel("kernel_close");
      await kernel.close?.();
    },
  };
}
