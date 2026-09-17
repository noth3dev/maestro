import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { Pool } from "pg";
import type { AuthorizedEffectExecutor } from "@maestro/authority";
import type { GitPort } from "@maestro/domain";
import {
  createIpPythonSessionManager,
  createUnavailableIpPythonKernel,
  type IpPythonBlockApproval,
  type IpPythonHostRequest,
  type IpPythonKernel,
  type IpPythonSessionBinding,
  type IpPythonSessionManager,
  type IpPythonStageBoundary,
} from "@maestro/agent-runtime";
import { createLocalGitPort } from "@maestro/git-adapter";
import { classifyHostEffects } from "@maestro/domain";
import { createIpPythonProductionKernel } from "../ipython-composition.js";
import { consumeCapabilityApprovals, readEnvironment } from "@maestro/persistence";
import { appendCapabilityJournal, appendIpPythonSessionJournal, recordIpPythonSessionStarted } from "@maestro/persistence";
import type { MaestroConfig } from "../config.js";
import type { ControlPlaneOverrides } from "../main.js";
import { createWorkerIpPythonAuthority, createWorkerWorktreeProvisioningAuthority, isWorkerFencingCurrent } from "./ipython-authority.js";
import {
  resolveWorkerIpPythonComposition,
  ipPythonJournalDetails,
  ipPythonStageDetails,
  ipPythonStageJournalEvent,
  type WorkerIpPythonComposition,
} from "./ipython.js";

function ipPythonEffectAction(method: string): string | undefined {
  const actions: Readonly<Record<string, string>> = {
    read_file: "project.file.read",
    write_file: "project.file.edit",
    run_test: "project.test.run",
    run_shell: "project.shell.run",
    run_environment: "project.environment.change",
    git_revision: "git.local.revision.read",
    git_create_branch: "git.local.branch.create",
    git_create_worktree: "git.local.worktree.create",
    git_commit: "git.local.commit",
    git_advance_branch: "git.local.branch.advance",
    git_remove_worktree: "git.local.worktree.remove",
  };
  return actions[method];
}

function ipPythonPayloadDigest(request: IpPythonHostRequest): string {
  return createHash("sha256")
    .update(JSON.stringify({ method: request.method, payload: request.payload }), "utf8")
    .digest("hex");
}

export interface IpPythonSessionsDeps {
  pool: Pool;
  config: MaestroConfig;
  overrides: ControlPlaneOverrides;
  authorityExecutor: AuthorizedEffectExecutor;
}

export function createControlPlaneIpPythonSessions(deps: IpPythonSessionsDeps): IpPythonSessionManager {
  const { pool, config, overrides, authorityExecutor } = deps;
  const ipythonSessions = createIpPythonSessionManager({
    createKernel: async (sessionId, binding) => {
      if (overrides.ipythonKernel !== undefined) return overrides.ipythonKernel;
      if (overrides.createIpPythonKernel !== undefined) return overrides.createIpPythonKernel(sessionId, binding);
      if (binding === undefined) throw new Error("IPython production kernel requires an authority binding");
      let composition: WorkerIpPythonComposition;
      try {
        composition = await resolveWorkerIpPythonComposition(pool, {
          commandId: (binding as IpPythonSessionBinding & { readonly admissionCommandId?: string }).admissionCommandId ?? binding.commandId,
          projectId: binding.projectId,
          goalId: binding.goalId,
          trustedWorktreeRoot: config.worktreeRoot,
        });
      } catch {
        return createUnavailableIpPythonKernel("Worker IPython composition is unavailable");
      }
      if (composition.environmentBindingValid === false)
        return createUnavailableIpPythonKernel("Worker environment binding is unavailable");
      if (composition.workspaceBindingValid === false) return createUnavailableIpPythonKernel("Worker worktree binding is unavailable");
      const provisioningAuthority = createWorkerWorktreeProvisioningAuthority(
        authorityExecutor,
        pool,
        {
          workspaceRoot: config.worktreeRoot,
          operatorId: binding.operatorId,
          projectId: binding.projectId,
          goalId: binding.goalId,
          commandId: binding.commandId,
          authorityPolicyVersion: binding.authorityPolicyVersion,
          budgetEffectCents: binding.budgetEffectCents,
          controlEpoch: binding.controlEpoch,
        },
        composition,
      );
      const prepareDirectory = async (directory: string): Promise<void> => {
        const decision = await provisioningAuthority.execute(
          {
            commandId: binding.commandId,
            projectId: binding.projectId,
            actorId: binding.operatorId,
            goalId: binding.goalId,
            action: "filesystem.directory.create",
            target: directory,
            policyVersion: binding.authorityPolicyVersion,
            budgetEffectCents: binding.budgetEffectCents,
            controlEpoch: binding.controlEpoch,
          },
          async () => {
            await mkdir(directory, { recursive: true });
          },
        );
        if (decision.effect !== "allow") throw new Error(`Worker directory preparation denied: ${decision.reason}`);
      };
      if (composition.workerId === undefined || composition.workspaceRoot === undefined) {
        if (composition.workerId === undefined || !isAbsolute(config.worktreeRoot))
          return createUnavailableIpPythonKernel("Worker worktree binding is unavailable");
        let repositoryPath: string | undefined;
        let provisioningGit: GitPort | undefined;
        let branchName: string | undefined;
        let derivedWorkspaceRoot: string | undefined;
        let worktreeCreated = false;
        let keepProvisionedResources = false;
        try {
          repositoryPath = composition.repositoryPath;
          const baseRevision = composition.baseRevision;
          if (repositoryPath === undefined || baseRevision === undefined || !isAbsolute(repositoryPath))
            throw new Error("Worker repository binding is unavailable");
          derivedWorkspaceRoot = resolve(config.worktreeRoot, "workers", composition.workerId);
          if (!(await isWorkerFencingCurrent(pool, composition, binding.projectId, binding.goalId, binding.controlEpoch)))
            throw new Error("Worker fence is stale");
          await prepareDirectory(resolve(config.worktreeRoot, "workers"));
          provisioningGit = createLocalGitPort({
            authority: provisioningAuthority,
            context: {
              commandId: binding.commandId,
              projectId: binding.projectId,
              actorId: binding.operatorId,
              goalId: binding.goalId,
              policyVersion: binding.authorityPolicyVersion,
              budgetEffectCents: binding.budgetEffectCents,
              controlEpoch: binding.controlEpoch,
            },
            workspaceRoot: config.worktreeRoot,
          });
          branchName = `worker/${composition.workerId}`;
          await provisioningGit.createBranch(repositoryPath, branchName, baseRevision);
          await provisioningGit.createWorktree(repositoryPath, derivedWorkspaceRoot, branchName);
          worktreeCreated = true;
          if ((await provisioningGit.headRevision(derivedWorkspaceRoot)) !== baseRevision)
            throw new Error("Worker worktree verification failed");
          if (!(await isWorkerFencingCurrent(pool, composition, binding.projectId, binding.goalId, binding.controlEpoch)))
            throw new Error("Worker fence is stale");
          let inserted: { readonly rowCount: number | null };
          try {
            inserted = await pool.query(
              `INSERT INTO worker_worktrees (worker_id, repository_path, worktree_path, branch_name, base_branch_name)
               VALUES ($1, $2, $3, $4, $5) ON CONFLICT (worker_id) DO NOTHING RETURNING worker_id`,
              // Native workers are created from the contract's immutable
              // revision, not a separately named branch. Store that commit
              // SHA as the durable base ref so integration can verify the
              // worker changed from the exact immutable starting point.
              [composition.workerId, repositoryPath, derivedWorkspaceRoot, branchName, baseRevision],
            );
          } catch (error) {
            // A lost database response makes resource ownership ambiguous; retain
            // the worktree for startup reconciliation instead of deleting it.
            keepProvisionedResources = true;
            throw error;
          }
          if (inserted.rowCount === 1) keepProvisionedResources = true;
          else {
            const existing = await pool.query<{ worktree_path: string; branch_name: string }>(
              "SELECT worktree_path, branch_name FROM worker_worktrees WHERE worker_id = $1",
              [composition.workerId],
            );
            if (existing.rows[0]?.worktree_path !== derivedWorkspaceRoot || existing.rows[0]?.branch_name !== branchName)
              throw new Error("Worker worktree binding conflict");
            keepProvisionedResources = true;
          }
          composition = await resolveWorkerIpPythonComposition(pool, {
            commandId: binding.admissionCommandId ?? binding.commandId,
            projectId: binding.projectId,
            goalId: binding.goalId,
            trustedWorktreeRoot: config.worktreeRoot,
          });
        } catch {
          if (!keepProvisionedResources && repositoryPath !== undefined && provisioningGit !== undefined && branchName !== undefined) {
            if (worktreeCreated && derivedWorkspaceRoot !== undefined)
              await provisioningGit.removeWorktree(repositoryPath, derivedWorkspaceRoot).catch(() => undefined);
            const branchCleanup = provisioningGit.removeBranch?.(repositoryPath, branchName);
            if (branchCleanup !== undefined) await branchCleanup.catch(() => undefined);
          }
          return createUnavailableIpPythonKernel("Worker worktree binding is unavailable");
        }
      }
      if (composition.environmentBindingValid === false)
        return createUnavailableIpPythonKernel("Worker environment binding is unavailable");
      if (composition.workspaceBindingValid === false) return createUnavailableIpPythonKernel("Worker worktree binding is unavailable");
      if (composition.workerId === undefined || composition.workspaceRoot === undefined)
        return createUnavailableIpPythonKernel("Worker worktree binding is unavailable");
      if (composition.allowedPaths === undefined) return createUnavailableIpPythonKernel("Worker path scope is unavailable");
      if (!(await isWorkerFencingCurrent(pool, composition, binding.projectId, binding.goalId, binding.controlEpoch)))
        return createUnavailableIpPythonKernel("Worker fence is stale");
      for (const allowedPath of composition.allowedPaths) {
        if (
          allowedPath.trim() === "" ||
          isAbsolute(allowedPath) ||
          allowedPath.split("/").some((part) => part === "..") ||
          allowedPath.split("\\").some((part) => part === "..")
        )
          return createUnavailableIpPythonKernel("Worker path scope is invalid");
        if (!(await isWorkerFencingCurrent(pool, composition, binding.projectId, binding.goalId, binding.controlEpoch)))
          return createUnavailableIpPythonKernel("Worker fence is stale");
        await prepareDirectory(resolve(composition.workspaceRoot, allowedPath));
      }
      const workerBinding: IpPythonSessionBinding & { readonly workerId: string } = {
        ...binding,
        workerId: composition.workerId,
        pathScope: composition.allowedPaths.map((allowedPath) => resolve(composition.workspaceRoot!, allowedPath)),
      };
      const processRef = `ipython:${randomUUID()}`;

      const twoStage =
        composition.environment !== undefined && composition.fencingToken !== undefined
          ? {
              fencingToken: composition.fencingToken,
              approve: async (effects: readonly IpPythonHostRequest[], blockDigest: string, currentBinding?: IpPythonSessionBinding) => {
                const effectBinding = currentBinding ?? binding;
                const actions = effects.map((effect) => ipPythonEffectAction(effect.method));
                let classification: ReturnType<typeof classifyHostEffects>;
                try {
                  if (actions.some((action) => action === undefined)) throw new Error("unknown_host_effect");
                  classification = classifyHostEffects(actions as string[], 0);
                } catch (error) {
                  await appendCapabilityJournal(pool, {
                    capabilityKind: "ipython",
                    projectId: effectBinding.projectId,
                    goalId: effectBinding.goalId,
                    commandId: effectBinding.commandId,
                    event: "rejection",
                    details: ipPythonJournalDetails(effectBinding, {
                      blockDigest,
                      effectCount: effects.length,
                      reason: error instanceof Error ? error.message : "host_effect_classification_failed",
                      saferAlternative: "Use a declared, bounded IPython host method",
                    }),
                  });
                  return false;
                }
                if (classification.tier === "automatic progress") {
                  await appendCapabilityJournal(pool, {
                    capabilityKind: "ipython",
                    projectId: effectBinding.projectId,
                    goalId: effectBinding.goalId,
                    commandId: effectBinding.commandId,
                    event: "approval",
                    details: ipPythonJournalDetails(effectBinding, { blockDigest, tier: classification.tier, effectCount: effects.length }),
                  });
                  return { approvalId: `automatic:${blockDigest}`, blockDigest, fencingToken: composition.fencingToken! };
                }
                const approvals = await Promise.all(
                  effects.map(async (effect) =>
                    pool.query<{ approval_id: string }>(
                      `SELECT approval_id FROM capability_approvals
               WHERE capability_kind = 'ipython' AND project_id = $1 AND goal_id = $2 AND command_id = $3
                 AND action = $4 AND target = $5 AND policy_version = $6 AND control_epoch = $7
                 AND budget_effect_cents = $8 AND decision = 'approved' AND revoked_at IS NULL AND expires_at > clock_timestamp()
               ORDER BY created_at DESC LIMIT 1`,
                      [
                        effectBinding.projectId,
                        effectBinding.goalId,
                        effectBinding.commandId,
                        ipPythonEffectAction(effect.method) ?? "unknown",
                        ipPythonPayloadDigest(effect),
                        effectBinding.authorityPolicyVersion,
                        effectBinding.controlEpoch,
                        effectBinding.budgetEffectCents,
                      ],
                    ),
                  ),
                );
                const approvalIds = approvals
                  .map((result) => result.rows[0]?.approval_id)
                  .filter((value): value is string => value !== undefined);
                if (approvalIds.length !== effects.length) {
                  await appendCapabilityJournal(pool, {
                    capabilityKind: "ipython",
                    projectId: effectBinding.projectId,
                    goalId: effectBinding.goalId,
                    commandId: effectBinding.commandId,
                    event: "rejection",
                    details: ipPythonJournalDetails(effectBinding, {
                      blockDigest,
                      tier: classification.tier,
                      effectCount: effects.length,
                      approvedEffectCount: approvalIds.length,
                      saferAlternative: "Request the required Goal-scoped approval before retrying",
                    }),
                  });
                  return false;
                }
                await appendCapabilityJournal(pool, {
                  capabilityKind: "ipython",
                  projectId: effectBinding.projectId,
                  goalId: effectBinding.goalId,
                  commandId: effectBinding.commandId,
                  event: "approval",
                  ...(approvalIds[0] === undefined ? {} : { approvalId: approvalIds[0] }),
                  details: ipPythonJournalDetails(effectBinding, {
                    blockDigest,
                    tier: classification.tier,
                    effectCount: effects.length,
                    approvalCount: approvalIds.length,
                  }),
                });
                return { approvalId: approvalIds.join(","), blockDigest, fencingToken: composition.fencingToken! };
              },
              consumeApproval: async (
                approval: IpPythonBlockApproval,
                effects: readonly IpPythonHostRequest[],
                currentBinding?: IpPythonSessionBinding,
              ) => {
                const effectBinding = currentBinding ?? binding;
                if (approval.approvalId.startsWith("automatic:")) return true;
                const approvalIds = approval.approvalId.split(",");
                if (approvalIds.length !== effects.length) return false;
                const consumptionInputs = effects.map((effect, index) => {
                  const action = ipPythonEffectAction(effect.method);
                  const approvalId = approvalIds[index];
                  if (action === undefined || approvalId === undefined) return undefined;
                  return {
                    approvalId,
                    capabilityKind: "ipython" as const,
                    projectId: effectBinding.projectId,
                    goalId: effectBinding.goalId,
                    commandId: effectBinding.commandId,
                    ...(effectBinding.admissionCommandId === undefined ? {} : { admissionCommandId: effectBinding.admissionCommandId }),
                    effectIndex: index,
                    action,
                    target: ipPythonPayloadDigest(effect),
                    policyVersion: effectBinding.authorityPolicyVersion,
                    controlEpoch: effectBinding.controlEpoch,
                    budgetEffectCents: effectBinding.budgetEffectCents,
                  };
                });
                if (consumptionInputs.some((input) => input === undefined)) return false;
                const consumed = await consumeCapabilityApprovals(
                  pool,
                  consumptionInputs as Array<NonNullable<(typeof consumptionInputs)[number]>>,
                );
                return consumed.length === effects.length && consumed.every((result) => result.consumed);
              },
              isFencingCurrent: async (fencingToken: string) =>
                fencingToken === composition.fencingToken &&
                (await isWorkerFencingCurrent(pool, composition, binding.projectId, binding.goalId, binding.controlEpoch)),
              recordEffectResult: async (
                index: number,
                request: IpPythonHostRequest,
                effectResult: { readonly state: string; readonly reason?: string },
                currentBinding?: IpPythonSessionBinding,
              ) => {
                const effectBinding = currentBinding ?? binding;
                await appendCapabilityJournal(pool, {
                  capabilityKind: "ipython",
                  projectId: effectBinding.projectId,
                  goalId: effectBinding.goalId,
                  commandId: effectBinding.commandId,
                  event: "effect_result",
                  details: ipPythonJournalDetails(effectBinding, {
                    index,
                    method: request.method,
                    payloadDigest: ipPythonPayloadDigest(request),
                    state: effectResult.state,
                    ...(effectResult.reason === undefined ? {} : { reason: effectResult.reason }),
                  }),
                });
              },
              recordStageBoundary: async (boundary: IpPythonStageBoundary, currentBinding?: IpPythonSessionBinding) => {
                const effectBinding = currentBinding ?? binding;
                await appendCapabilityJournal(pool, {
                  capabilityKind: "ipython",
                  projectId: effectBinding.projectId,
                  goalId: effectBinding.goalId,
                  commandId: effectBinding.commandId,
                  event: ipPythonStageJournalEvent(boundary.outcome),
                  details: ipPythonJournalDetails(effectBinding, ipPythonStageDetails(boundary)),
                });
              },
            }
          : undefined;
      const composedKernel = createIpPythonProductionKernel(
        {
          authority: createWorkerIpPythonAuthority(
            authorityExecutor,
            pool,
            {
              operatorId: binding.operatorId,
              projectId: binding.projectId,
              goalId: binding.goalId,
              commandId: binding.commandId,
              authorityPolicyVersion: binding.authorityPolicyVersion,
              budgetEffectCents: binding.budgetEffectCents,
              controlEpoch: binding.controlEpoch,
            },
            composition,
          ),
          workspaceRoot: composition.workspaceRoot,
          pythonExecutable: config.ipythonPythonExecutable ?? "/usr/bin/python3",
          processRef,
          ...(twoStage === undefined
            ? {}
            : {
                localEnvironment: composition.environment,
                readEnvironment: async () => {
                  const current = await readEnvironment(pool, composition.environment!.environmentId);
                  if (
                    current === undefined ||
                    current.workerId !== composition.workerId ||
                    current.goalId !== composition.environment!.goalId ||
                    current.projectId !== composition.environment!.projectId
                  )
                    return undefined;
                  return current;
                },
                twoStage,
              }),
          onStarted: async (event) => {
            await recordIpPythonSessionStarted(pool, {
              sessionId,
              processRef: event.processRef,
              projectId: binding.projectId,
              goalId: binding.goalId,
              processPid: event.processPid,
              parentPid: event.parentPid,
              details: {
                ...(event.processGroupId === undefined ? {} : { process_group_id: event.processGroupId }),
                ...(event.processSessionId === undefined ? {} : { process_session_id: event.processSessionId }),
                ...(event.processStartTime === undefined ? {} : { process_start_time: event.processStartTime }),
                worker_id: composition.workerId,
              },
            });
          },
          onHostRequest: async (request, result, currentBinding) => {
            const effectBinding = currentBinding ?? workerBinding;
            await appendCapabilityJournal(pool, {
              capabilityKind: "ipython",
              projectId: effectBinding.projectId,
              goalId: effectBinding.goalId,
              commandId: effectBinding.commandId,
              event: "effect_result",
              details: ipPythonJournalDetails(effectBinding, {
                method: request.method,
                payloadDigest: ipPythonPayloadDigest(request),
                state: result.state,
                ...(result.reason === undefined ? {} : { reason: result.reason }),
              }),
            });
          },
          onLifecycle: async (event) => {
            await appendIpPythonSessionJournal(pool, {
              sessionId,
              processRef: event.processRef,
              projectId: binding.projectId,
              goalId: binding.goalId,
              event: "orphaned",
              reason: event.reason,
              processPid: event.processPid,
              parentPid: event.parentPid,
              details: {
                ...(event.processGroupId === undefined ? {} : { process_group_id: event.processGroupId }),
                ...(event.processSessionId === undefined ? {} : { process_session_id: event.processSessionId }),
                ...(event.processStartTime === undefined ? {} : { process_start_time: event.processStartTime }),
                worker_id: composition.workerId,
              },
            });
          },
        },
        sessionId,
        workerBinding,
      );
      return {
        async execute(request: Parameters<IpPythonKernel["execute"]>[0]) {
          const requestBinding =
            request.binding === undefined
              ? workerBinding
              : { ...workerBinding, commandId: request.binding.commandId, toolCallId: request.binding.toolCallId };
          return composedKernel.execute({ ...request, binding: requestBinding });
        },
        ...(composedKernel.interrupt === undefined ? {} : { interrupt: composedKernel.interrupt }),
        ...(composedKernel.close === undefined ? {} : { close: composedKernel.close }),
      };
    },
  });
  return ipythonSessions;
}
