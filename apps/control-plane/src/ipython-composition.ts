import type { ActionRequest } from "@maestro/authority";
import { createAuthorizedReadOnlyFilePort, type ReadOnlyFileAuthorityGateway } from "@maestro/environment-adapter";
import { createLocalGitPort } from "@maestro/git-adapter";
import {
  createIpPythonGitRevisionAdapter,
  createIpPythonOwnedProcessChannel,
  createIpPythonProcessKernel,
  createIpPythonReadOnlyGateway,
  createReadOnlyHostRequestHandler,
  type IpPythonHostBinding,
  type IpPythonKernel,
} from "@maestro/agent-runtime";

export interface IpPythonProductionCompositionOptions {
  readonly authority: ReadOnlyFileAuthorityGateway;
  readonly workspaceRoot: string;
  readonly pythonExecutable: string;
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
  const hostRequest = createReadOnlyHostRequestHandler({ binding, gateway });
  const channel = createIpPythonOwnedProcessChannel({ pythonExecutable: options.pythonExecutable, cwd: options.workspaceRoot });
  return createIpPythonProcessKernel({ createProcess: () => channel, hostRequest }, sessionId, binding);
}
