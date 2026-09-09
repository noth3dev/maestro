import type { ActionRequest } from "@maestro/authority";
import { createAuthorizedReadOnlyFilePort, type ReadOnlyFileAuthorityGateway } from "@maestro/environment-adapter";
import { createLocalGitPort } from "@maestro/git-adapter";
import {
  createIpPythonGitRevisionAdapter,
  createIpPythonOwnedProcessChannel,
  createIpPythonProcessKernel,
  createIpPythonReadOnlyGateway,
  createReadOnlyHostRequestHandler,
  createLocalHostRequestHandler,
  type IpPythonHostBinding,
  type IpPythonKernel,
  type IpPythonLocalEffectsGateway,
  type IpPythonProcessOrphanedEvent,
  type IpPythonProcessStartedEvent,
} from "@maestro/agent-runtime";

export interface IpPythonProductionCompositionOptions {
  readonly authority: ReadOnlyFileAuthorityGateway;
  readonly workspaceRoot: string;
  readonly pythonExecutable: string;
  readonly processRef?: string;
  /** Optional local-effect surface; every adapter must already be authority-backed. */
  readonly localEffects?: IpPythonLocalEffectsGateway;
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
  const hostRequest = options.localEffects === undefined
    ? createReadOnlyHostRequestHandler({ binding, gateway })
    : createLocalHostRequestHandler({ binding, readOnly: gateway, effects: options.localEffects });
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
