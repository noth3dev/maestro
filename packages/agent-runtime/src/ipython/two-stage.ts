import { createHash } from "node:crypto";
import type { IpPythonExecutionRequest, IpPythonExecutionResult, IpPythonSessionBinding } from "../ipython-tool.js";

export interface IpPythonHostRequest {
  readonly requestId: string;
  readonly hostRequestId: string;
  readonly method: string;
  readonly payload: unknown;
}

export type IpPythonTwoStageMode = "collect" | "execute";
export type IpPythonStageBoundaryName = IpPythonTwoStageMode | "approval" | "commit";

export interface IpPythonCommitLease {
  readonly fencingToken: string;
  /** The authority adapter must call this immediately before its mutation. */
  readonly assertValid: () => void | Promise<void>;
}

export interface IpPythonPreparedEffect {
  /** Result visible to the Python block during stage two. */
  readonly result: IpPythonExecutionResult;
  /** Commit through the authority adapter's fence/stop boundary. Earlier commits are not rolled back. */
  readonly commit: (lease: IpPythonCommitLease) => IpPythonExecutionResult | Promise<IpPythonExecutionResult>;
  /** Release a prepared effect when stage two stops or diverges before commit. */
  readonly rollback: () => void | Promise<void>;
}

export interface IpPythonBlockApproval {
  readonly approvalId: string;
  readonly blockDigest: string;
  readonly fencingToken: string;
}

export interface IpPythonStageBoundary {
  readonly stage: IpPythonStageBoundaryName;
  readonly outcome: "completed" | "rejected" | "stopped" | "stale" | "diverged" | "failed";
  readonly sessionId: string;
  readonly fencingToken: string;
  readonly blockDigest: string;
  readonly approvedBlockDigest?: string;
  readonly intentCount: number;
  readonly appliedCount: number;
  readonly skippedCount: number;
  readonly reason?: string;
}

export interface IpPythonTwoStageExecutionOptions {
  readonly request: IpPythonExecutionRequest;
  readonly fencingToken: string;
  readonly runBlock: (
    request: IpPythonExecutionRequest,
    mode: IpPythonTwoStageMode,
    hostRequest: (request: IpPythonHostRequest) => Promise<IpPythonExecutionResult>,
  ) => Promise<IpPythonExecutionResult>;
  readonly approve: (
    effects: readonly IpPythonHostRequest[],
    blockDigest: string,
    binding?: IpPythonSessionBinding,
  ) => IpPythonBlockApproval | false | Promise<IpPythonBlockApproval | false>;
  /** Consume persisted repetition budgets before stage-two preparation or effects. */
  readonly consumeApproval?: (
    approval: IpPythonBlockApproval,
    effects: readonly IpPythonHostRequest[],
    binding?: IpPythonSessionBinding,
  ) => boolean | Promise<boolean>;
  readonly isFencingCurrent: (fencingToken: string) => boolean | Promise<boolean>;
  readonly isStopRequested: () => boolean | Promise<boolean>;
  readonly prepareEffect: (request: IpPythonHostRequest) => IpPythonPreparedEffect | Promise<IpPythonPreparedEffect>;
  /** Persist every applied and skipped effect outcome before returning. */
  readonly recordEffectResult: (
    index: number,
    request: IpPythonHostRequest,
    result: IpPythonExecutionResult,
    binding?: IpPythonSessionBinding,
  ) => void | Promise<void>;
  /** Persist each stage boundary, including empty and rejected stages. */
  readonly recordStageBoundary: (boundary: IpPythonStageBoundary, binding?: IpPythonSessionBinding) => void | Promise<void>;
}

function canonicalHostPayload(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalHostPayload).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalHostPayload(record[key])}`)
    .join(",")}}`;
}

function hostEffectKey(request: IpPythonHostRequest): string {
  return `${request.method}:${canonicalHostPayload(request.payload)}`;
}

function blockDigest(request: IpPythonExecutionRequest, effects: readonly IpPythonHostRequest[]): string {
  return createHash("sha256")
    .update(canonicalHostPayload({ request, effects: effects.map(hostEffectKey) }), "utf8")
    .digest("hex");
}

function queuedHostResponse(): IpPythonExecutionResult {
  return { state: "ok", dataClass: "workspace", content: "[effect queued]" };
}

function unknownResult(reason: string, content = `IPython two-stage execution failed: ${reason}`): IpPythonExecutionResult {
  return { state: "unknown", dataClass: "workspace", content, reason };
}

function errorResult(reason: string, content = `IPython two-stage execution rejected: ${reason}`): IpPythonExecutionResult {
  return { state: "error", dataClass: "workspace", content, reason };
}

function partialCommitResult(appliedCount: number, reason: string): IpPythonExecutionResult {
  return unknownResult(
    "partial_commit",
    `IPython effect queue applied ${appliedCount} effect(s) before ${reason}; outcome requires reconciliation`,
  );
}

/**
 * Run one IPython block through collect, approve, prepare, and queue-bound
 * commit. Collect never calls a host effect. Stage two receives prepared
 * effect results, but commits them only after its complete intent digest
 * matches the approved stage-one digest. Commit is deliberately best-effort: a
 * later effect cannot roll back an earlier external commit, so partial outcomes
 * are returned as unknown and must be reconciled from the durable journal.
 */
export async function executeIpPythonBlockInTwoStages(options: IpPythonTwoStageExecutionOptions): Promise<IpPythonExecutionResult> {
  const collected: IpPythonHostRequest[] = [];
  const queued: IpPythonHostRequest[] = [];
  const prepared: Array<IpPythonPreparedEffect | undefined> = [];
  const committed = new Set<number>();
  const requestBinding = options.request.binding;
  const requestDigest = (effects: readonly IpPythonHostRequest[]) => blockDigest(options.request, effects);
  let journalFailed = false;
  let stopCheckFailed = false;
  const boundary = async (value: IpPythonStageBoundary): Promise<boolean> => {
    try {
      await options.recordStageBoundary(value, requestBinding);
      return true;
    } catch {
      journalFailed = true;
      return false;
    }
  };
  const effectRecord = async (index: number, effect: IpPythonHostRequest, result: IpPythonExecutionResult): Promise<boolean> => {
    try {
      await options.recordEffectResult(index, effect, result, requestBinding);
      return true;
    } catch {
      journalFailed = true;
      return false;
    }
  };
  const stopRequested = async (): Promise<boolean> => {
    try {
      return await options.isStopRequested();
    } catch {
      stopCheckFailed = true;
      return true;
    }
  };
  const fenceCurrent = async (): Promise<boolean> => {
    try {
      return await options.isFencingCurrent(options.fencingToken);
    } catch {
      return false;
    }
  };
  const skip = async (effects: readonly IpPythonHostRequest[], reason: string, start = 0): Promise<boolean> => {
    let recorded = true;
    for (let index = start; index < effects.length; index += 1) {
      if (!(await effectRecord(index, effects[index]!, unknownResult(reason, `IPython effect was not run: ${reason}`)))) recorded = false;
    }
    return recorded;
  };
  const rollback = async (): Promise<boolean> => {
    let rolledBack = true;
    for (const [index, item] of prepared.entries()) {
      if (item === undefined || committed.has(index)) continue;
      try {
        await item.rollback();
      } catch {
        rolledBack = false;
      }
    }
    return rolledBack;
  };
  const failJournal = async (
    stage: IpPythonStageBoundaryName,
    digest: string,
    intentCount: number,
    appliedCount: number,
    skippedCount: number,
  ): Promise<IpPythonExecutionResult> => {
    const rolledBack = await rollback();
    const skipped = await skip(queued, rolledBack ? "journal_failed" : "rollback_failed", appliedCount);
    const boundaryWritten = await boundary({
      stage,
      outcome: "failed",
      sessionId: options.request.sessionId,
      fencingToken: options.fencingToken,
      blockDigest: digest,
      intentCount,
      appliedCount,
      skippedCount,
      reason: rolledBack ? "journal_failed" : "rollback_failed",
    });
    return !skipped || !boundaryWritten
      ? unknownResult("journal_failed")
      : unknownResult(rolledBack ? "journal_failed" : "rollback_failed");
  };

  let stageOne: IpPythonExecutionResult;
  try {
    stageOne = await options.runBlock(options.request, "collect", async (request) => {
      collected.push(request);
      return queuedHostResponse();
    });
  } catch (error) {
    const digest = requestDigest(collected);
    const skipped = await skip(collected, "stage_one_failed");
    const boundaryWritten = await boundary({
      stage: "collect",
      outcome: "failed",
      sessionId: options.request.sessionId,
      fencingToken: options.fencingToken,
      blockDigest: digest,
      intentCount: collected.length,
      appliedCount: 0,
      skippedCount: collected.length,
      reason: "stage_one_failed",
    });
    if (!skipped || !boundaryWritten) return unknownResult("journal_failed");
    return unknownResult("stage_one_failed", error instanceof Error ? error.message : String(error));
  }
  const collectedDigest = requestDigest(collected);
  let stageOneStopRequested = false;
  try {
    stageOneStopRequested = await options.isStopRequested();
  } catch {
    stopCheckFailed = true;
  }
  const stageOneInterrupted =
    !stopCheckFailed &&
    (stageOneStopRequested || stageOne.reason === "stop_requested" || stageOne.reason === "user_stop") &&
    (stageOne.state === "ok" || stageOne.state === "cancelled");
  const collectBoundaryOutcome = stopCheckFailed
    ? "failed"
    : stageOneInterrupted
      ? "stopped"
      : stageOne.state === "ok"
        ? "completed"
        : "failed";
  const collectBoundaryWritten = await boundary({
    stage: "collect",
    outcome: collectBoundaryOutcome,
    sessionId: options.request.sessionId,
    fencingToken: options.fencingToken,
    blockDigest: collectedDigest,
    intentCount: collected.length,
    appliedCount: 0,
    skippedCount: stageOneInterrupted || stopCheckFailed || stageOne.state !== "ok" ? collected.length : 0,
    ...(stageOneInterrupted || stopCheckFailed || stageOne.state !== "ok"
      ? {
          reason: stopCheckFailed
            ? "stop_check_failed"
            : (stageOne.reason ?? (stageOneInterrupted ? "stop_requested" : "stage_one_failed")),
        }
      : {}),
  });
  if (!collectBoundaryWritten) {
    await skip(collected, "journal_failed");
    return unknownResult("journal_failed");
  }
  if (stageOne.state !== "ok" || stopCheckFailed) {
    const reason = stopCheckFailed ? "stop_check_failed" : stageOneInterrupted ? "stop_requested" : "stage_one_failed";
    const skipped = await skip(collected, reason);
    if (!skipped) return unknownResult("journal_failed");
    return stopCheckFailed ? unknownResult(reason) : stageOne;
  }
  if (stageOneInterrupted) {
    const skipped = await skip(collected, "stop_requested");
    if (!skipped) return unknownResult("journal_failed");
    return { state: "cancelled", dataClass: "workspace", content: "IPython block stopped after collect", reason: "stop_requested" };
  }

  let approval: IpPythonBlockApproval | false;
  try {
    approval = await options.approve(collected, collectedDigest, requestBinding);
  } catch (error) {
    const skipped = await skip(collected, "approval_failed");
    const boundaryWritten = await boundary({
      stage: "approval",
      outcome: "failed",
      sessionId: options.request.sessionId,
      fencingToken: options.fencingToken,
      blockDigest: collectedDigest,
      intentCount: collected.length,
      appliedCount: 0,
      skippedCount: collected.length,
      reason: "approval_failed",
    });
    if (!skipped || !boundaryWritten) return unknownResult("journal_failed");
    return unknownResult("approval_failed", error instanceof Error ? error.message : String(error));
  }
  const approvalRecord =
    approval !== false &&
    approval !== null &&
    typeof approval === "object" &&
    typeof (approval as { approvalId?: unknown }).approvalId === "string" &&
    typeof (approval as { blockDigest?: unknown }).blockDigest === "string" &&
    typeof (approval as { fencingToken?: unknown }).fencingToken === "string"
      ? (approval as IpPythonBlockApproval)
      : undefined;
  if (
    approvalRecord === undefined ||
    approvalRecord.approvalId.trim() === "" ||
    approvalRecord.blockDigest !== collectedDigest ||
    approvalRecord.fencingToken !== options.fencingToken
  ) {
    const skipped = await skip(collected, "approval_rejected");
    const boundaryWritten = await boundary({
      stage: "approval",
      outcome: "rejected",
      sessionId: options.request.sessionId,
      fencingToken: options.fencingToken,
      blockDigest: collectedDigest,
      intentCount: collected.length,
      appliedCount: 0,
      skippedCount: collected.length,
      reason: "approval_rejected",
    });
    if (!skipped || !boundaryWritten) return unknownResult("journal_failed");
    return errorResult("approval_rejected", "IPython block approval identity was rejected");
  }
  const approved = approvalRecord;
  if (
    !(await boundary({
      stage: "approval",
      outcome: "completed",
      sessionId: options.request.sessionId,
      fencingToken: options.fencingToken,
      blockDigest: collectedDigest,
      approvedBlockDigest: approved.blockDigest,
      intentCount: collected.length,
      appliedCount: 0,
      skippedCount: 0,
    }))
  ) {
    await skip(collected, "journal_failed");
    return unknownResult("journal_failed");
  }
  if (await stopRequested()) {
    const skipped = await skip(collected, "stop_requested");
    const boundaryWritten = await boundary({
      stage: "execute",
      outcome: "stopped",
      sessionId: options.request.sessionId,
      fencingToken: options.fencingToken,
      blockDigest: collectedDigest,
      approvedBlockDigest: approved.blockDigest,
      intentCount: collected.length,
      appliedCount: 0,
      skippedCount: collected.length,
      reason: "stop_requested",
    });
    if (!skipped || !boundaryWritten) return unknownResult("journal_failed");
    return { state: "cancelled", dataClass: "workspace", content: "IPython block stopped before execute", reason: "stop_requested" };
  }
  if (!(await fenceCurrent())) {
    const skipped = await skip(collected, "stale_fencing_token");
    const boundaryWritten = await boundary({
      stage: "execute",
      outcome: "stale",
      sessionId: options.request.sessionId,
      fencingToken: options.fencingToken,
      blockDigest: collectedDigest,
      approvedBlockDigest: approved.blockDigest,
      intentCount: collected.length,
      appliedCount: 0,
      skippedCount: collected.length,
      reason: "stale_fencing_token",
    });
    if (!skipped || !boundaryWritten) return unknownResult("journal_failed");
    return unknownResult("stale_fencing_token", "IPython block fencing token is stale");
  }

  let stageTwo: IpPythonExecutionResult;
  let stageTwoAbortReason: "stop_requested" | "stop_check_failed" | "stale_fencing_token" | undefined;
  try {
    stageTwo = await options.runBlock(options.request, "execute", async (request) => {
      const index = queued.length;
      queued.push(request);
      prepared.push(undefined);
      if (await stopRequested()) {
        stageTwoAbortReason = stopCheckFailed ? "stop_check_failed" : "stop_requested";
        throw new Error(stageTwoAbortReason);
      }
      if (!(await fenceCurrent())) {
        stageTwoAbortReason = "stale_fencing_token";
        throw new Error(stageTwoAbortReason);
      }
      const transaction = await options.prepareEffect(request);
      if (transaction.result.state !== "ok") throw new Error(transaction.result.reason ?? "prepared effect was not successful");
      prepared[index] = transaction;
      return transaction.result;
    });
  } catch (error) {
    const reason = stageTwoAbortReason ?? "stage_two_failed";
    const rolledBack = await rollback();
    const skipped = await skip(queued, rolledBack ? reason : "rollback_failed");
    const boundaryWritten = await boundary({
      stage: "execute",
      outcome: rolledBack ? (reason === "stop_requested" ? "stopped" : reason === "stale_fencing_token" ? "stale" : "failed") : "failed",
      sessionId: options.request.sessionId,
      fencingToken: options.fencingToken,
      blockDigest: requestDigest(queued),
      approvedBlockDigest: approved.blockDigest,
      intentCount: queued.length,
      appliedCount: 0,
      skippedCount: queued.length,
      reason: rolledBack ? reason : "rollback_failed",
    });
    if (!skipped || !boundaryWritten) return unknownResult("journal_failed");
    return unknownResult(rolledBack ? reason : "rollback_failed", error instanceof Error ? error.message : String(error));
  }
  const stageTwoDigest = requestDigest(queued);
  if (stageTwo.state !== "ok") {
    const reason = stageTwoAbortReason ?? stageTwo.reason ?? "stage_two_failed";
    const rolledBack = await rollback();
    const stageTwoInterrupted = stageTwo.state === "cancelled" && (reason === "stop_requested" || reason === "user_stop");
    const stageTwoStale = reason === "stale_fencing_token";
    const boundaryWritten = await boundary({
      stage: "execute",
      outcome: rolledBack ? (stageTwoStale ? "stale" : stageTwoInterrupted ? "stopped" : "failed") : "failed",
      sessionId: options.request.sessionId,
      fencingToken: options.fencingToken,
      blockDigest: stageTwoDigest,
      approvedBlockDigest: approved.blockDigest,
      intentCount: queued.length,
      appliedCount: 0,
      skippedCount: queued.length,
      reason: rolledBack ? reason : "rollback_failed",
    });
    const skipped = await skip(queued, rolledBack ? reason : "rollback_failed");
    if (!skipped || !boundaryWritten) return unknownResult("journal_failed");
    return rolledBack ? stageTwo : unknownResult("rollback_failed");
  }
  if (
    stageTwoDigest !== approved.blockDigest ||
    collected.length !== queued.length ||
    prepared.some((item) => item === undefined) ||
    collected.some((request, index) => hostEffectKey(request) !== hostEffectKey(queued[index]!))
  ) {
    const rolledBack = await rollback();
    const skipped = await skip(queued, rolledBack ? "stage_divergence" : "rollback_failed");
    const boundaryWritten = await boundary({
      stage: "execute",
      outcome: rolledBack ? "diverged" : "failed",
      sessionId: options.request.sessionId,
      fencingToken: options.fencingToken,
      blockDigest: stageTwoDigest,
      approvedBlockDigest: approved.blockDigest,
      intentCount: queued.length,
      appliedCount: 0,
      skippedCount: queued.length,
      reason: rolledBack ? "stage_divergence" : "rollback_failed",
    });
    if (!skipped || !boundaryWritten) return unknownResult("journal_failed");
    return rolledBack
      ? errorResult("stage_divergence", "IPython block effect set changed between stages")
      : unknownResult("rollback_failed");
  }
  if (
    !(await boundary({
      stage: "execute",
      outcome: "completed",
      sessionId: options.request.sessionId,
      fencingToken: options.fencingToken,
      blockDigest: stageTwoDigest,
      approvedBlockDigest: approved.blockDigest,
      intentCount: queued.length,
      appliedCount: 0,
      skippedCount: 0,
    }))
  ) {
    await rollback();
    await skip(queued, "journal_failed");
    return unknownResult("journal_failed");
  }

  let appliedCount = 0;
  let finalCommitResult = stageTwo;
  let approvalConsumed = options.consumeApproval === undefined;
  for (let index = 0; index < prepared.length; index += 1) {
    const stop = await stopRequested();
    const fence = await fenceCurrent();
    if (stop || !fence) {
      const reason = stop ? (stopCheckFailed ? "stop_check_failed" : "stop_requested") : "stale_fencing_token";
      const rolledBack = await rollback();
      const skipped = await skip(queued, rolledBack ? reason : "rollback_failed", index);
      const boundaryWritten = await boundary({
        stage: "commit",
        outcome: rolledBack ? (reason === "stop_requested" ? "stopped" : reason === "stale_fencing_token" ? "stale" : "failed") : "failed",
        sessionId: options.request.sessionId,
        fencingToken: options.fencingToken,
        blockDigest: stageTwoDigest,
        approvedBlockDigest: approved.blockDigest,
        intentCount: queued.length,
        appliedCount,
        skippedCount: queued.length - index,
        reason: rolledBack ? reason : "rollback_failed",
      });
      if (!skipped || !boundaryWritten) return unknownResult("journal_failed");
      if (!rolledBack) return unknownResult("rollback_failed");
      return appliedCount > 0
        ? partialCommitResult(appliedCount, reason)
        : reason === "stop_requested"
          ? { state: "cancelled", dataClass: "workspace", content: `IPython effect queue stopped after ${appliedCount} effect(s)`, reason }
          : unknownResult(reason, `IPython effect queue stopped after ${appliedCount} effect(s)`);
    }
    if (!approvalConsumed) {
      let consumed = false;
      try {
        consumed = await options.consumeApproval!(approved, collected, requestBinding);
      } catch {
        consumed = false;
      }
      if (!consumed) {
        const skipped = await skip(collected, "approval_consumption_rejected");
        const boundaryWritten = await boundary({
          stage: "execute",
          outcome: "rejected",
          sessionId: options.request.sessionId,
          fencingToken: options.fencingToken,
          blockDigest: collectedDigest,
          approvedBlockDigest: approved.blockDigest,
          intentCount: collected.length,
          appliedCount: 0,
          skippedCount: collected.length,
          reason: "approval_consumption_rejected",
        });
        if (!skipped || !boundaryWritten) return unknownResult("journal_failed");
        return errorResult("approval_consumption_rejected", "IPython block approval repetition scope was exhausted or already consumed");
      }
      approvalConsumed = true;
    }
    const item = prepared[index];
    if (item === undefined) return unknownResult("stage_two_failed");
    let result: IpPythonExecutionResult;
    let leaseValidated = false;
    try {
      result = await item.commit({
        fencingToken: options.fencingToken,
        assertValid: async () => {
          if (await stopRequested()) throw new Error("stop_requested");
          if (!(await fenceCurrent())) throw new Error("stale_fencing_token");
          leaseValidated = true;
        },
      });
      if (!leaseValidated) result = unknownResult("unvalidated_commit", "IPython effect commit did not validate its fencing lease");
    } catch (error) {
      result = unknownResult(
        error instanceof Error && ["stop_requested", "stale_fencing_token"].includes(error.message) ? error.message : "effect_failed",
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!(await effectRecord(index, queued[index]!, result)))
      return failJournal("commit", stageTwoDigest, queued.length, appliedCount, queued.length - index);
    if (result.state !== "ok") {
      const rolledBack = await rollback();
      const skipped = await skip(queued, rolledBack ? "effect_failed" : "rollback_failed", index + 1);
      const boundaryWritten = await boundary({
        stage: "commit",
        outcome: rolledBack ? "failed" : "failed",
        sessionId: options.request.sessionId,
        fencingToken: options.fencingToken,
        blockDigest: stageTwoDigest,
        approvedBlockDigest: approved.blockDigest,
        intentCount: queued.length,
        appliedCount,
        skippedCount: queued.length - index - 1,
        reason: rolledBack ? "effect_failed" : "rollback_failed",
      });
      if (!skipped || !boundaryWritten) return unknownResult("journal_failed");
      if (appliedCount > 0) return partialCommitResult(appliedCount, "an effect failed");
      if (
        result.reason === "stop_requested" ||
        result.reason === "stale_fencing_token" ||
        result.reason === "authority_or_boundary_rejected"
      )
        return result;
      return unknownResult(
        "effect_outcome_unknown",
        `IPython effect commit failed before a durable outcome was established: ${result.reason ?? "unknown"}`,
      );
    }
    committed.add(index);
    finalCommitResult = result;
    appliedCount += 1;
  }
  if (
    !(await boundary({
      stage: "commit",
      outcome: "completed",
      sessionId: options.request.sessionId,
      fencingToken: options.fencingToken,
      blockDigest: stageTwoDigest,
      approvedBlockDigest: approved.blockDigest,
      intentCount: queued.length,
      appliedCount,
      skippedCount: 0,
    }))
  )
    return unknownResult("journal_failed");
  if (journalFailed) return unknownResult("journal_failed");
  return {
    ...finalCommitResult,
    content: stageTwo.content === "" ? finalCommitResult.content : stageTwo.content,
    ...(stageTwo.truncated === undefined ? {} : { truncated: stageTwo.truncated }),
  };
}
