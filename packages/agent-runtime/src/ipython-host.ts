import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import type { IpPythonExecutionRequest, IpPythonExecutionResult, IpPythonKernel, IpPythonSessionBinding } from "./ipython-tool.js";

export const IPYTHON_PROTOCOL_VERSION = 1 as const;

export interface IpPythonReadyFrame {
  readonly version: typeof IPYTHON_PROTOCOL_VERSION;
  readonly type: "ready";
  readonly runtime: "python";
}

type DataClass = IpPythonExecutionResult["dataClass"];

export interface IpPythonExecuteFrame {
  readonly version: typeof IPYTHON_PROTOCOL_VERSION;
  readonly type: "execute";
  readonly requestId: string;
  readonly sessionId: string;
  readonly code: string;
}

export interface IpPythonHostRequestFrame {
  readonly version: typeof IPYTHON_PROTOCOL_VERSION;
  readonly type: "host_request";
  readonly requestId: string;
  readonly hostRequestId: string;
  readonly method: string;
  readonly payload: unknown;
}

export interface IpPythonDoneFrame {
  readonly version: typeof IPYTHON_PROTOCOL_VERSION;
  readonly type: "done";
  readonly requestId: string;
  readonly state: IpPythonExecutionResult["state"];
  readonly dataClass: DataClass;
  readonly content: string;
  readonly reason?: string;
  readonly truncated?: boolean;
}

export interface IpPythonInterruptFrame {
  readonly version: typeof IPYTHON_PROTOCOL_VERSION;
  readonly type: "interrupt";
  readonly requestId: string;
}

export interface IpPythonShutdownFrame {
  readonly version: typeof IPYTHON_PROTOCOL_VERSION;
  readonly type: "shutdown";
}

export interface IpPythonEventFrame {
  readonly version: typeof IPYTHON_PROTOCOL_VERSION;
  readonly type: "event";
  readonly requestId: string;
  readonly stream: "stdout" | "stderr";
  readonly text: string;
}

export interface IpPythonErrorFrame {
  readonly version: typeof IPYTHON_PROTOCOL_VERSION;
  readonly type: "error";
  readonly requestId: string;
  readonly reason: string;
}

export interface IpPythonHostResponseFrame {
  readonly version: typeof IPYTHON_PROTOCOL_VERSION;
  readonly type: "host_response";
  readonly requestId: string;
  readonly hostRequestId: string;
  readonly ok: boolean;
  readonly result?: IpPythonExecutionResult;
  readonly error?: string;
}

export type IpPythonFrame = IpPythonReadyFrame | IpPythonExecuteFrame | IpPythonHostRequestFrame | IpPythonDoneFrame | IpPythonEventFrame | IpPythonErrorFrame | IpPythonHostResponseFrame | IpPythonInterruptFrame | IpPythonShutdownFrame;

export interface IpPythonTransport {
  send(frame: IpPythonFrame): void | Promise<void>;
  onFrame(listener: (frame: unknown) => void): () => void;
  onClose(listener: (reason?: string) => void): () => void;
  interrupt(requestId: string): void | Promise<void>;
  close(): void | Promise<void>;
}

export interface IpPythonLineChannel {
  write(data: string): void | Promise<void>;
  onData(listener: (chunk: string | Buffer) => void): () => void;
  onClose(listener: (reason?: string) => void): () => void;
  close(): void | Promise<void>;
}

const MAX_FRAME_BYTES = 1_048_576;

export function createIpPythonJsonLinesTransport(channel: IpPythonLineChannel): IpPythonTransport {
  const decoder = new StringDecoder("utf8");
  const frameListeners = new Set<(frame: unknown) => void>();
  const closeListeners = new Set<(reason?: string) => void>();
  let pending = "";
  let closed = false;
  const removeData = channel.onData((chunk) => {
    pending += decoder.write(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    if (Buffer.byteLength(pending, "utf8") > MAX_FRAME_BYTES) {
      pending = "";
      for (const listener of closeListeners) listener("protocol_frame_too_large");
      return;
    }
    for (;;) {
      const newline = pending.indexOf("\n");
      if (newline < 0) return;
      const line = pending.slice(0, newline).replace(/\r$/, "");
      pending = pending.slice(newline + 1);
      if (line.trim() === "") continue;
      try { for (const listener of frameListeners) listener(JSON.parse(line)); }
      catch { for (const listener of frameListeners) listener(undefined); }
    }
  });
  const removeChannelClose = channel.onClose((reason) => { for (const listener of closeListeners) listener(reason); });
  return {
    send(frame) {
      if (closed) throw new Error("IPython transport is closed");
      return channel.write(`${JSON.stringify(frame)}\n`);
    },
    onFrame(listener) { frameListeners.add(listener); return () => frameListeners.delete(listener); },
    onClose(listener) { closeListeners.add(listener); return () => closeListeners.delete(listener); },
    interrupt(requestId) { return channel.write(`${JSON.stringify({ version: IPYTHON_PROTOCOL_VERSION, type: "interrupt", requestId })}\n`); },
    async close() {
      if (closed) return;
      closed = true;
      removeData();
      removeChannelClose();
      const listeners = [...closeListeners];
      closeListeners.clear();
      for (const listener of listeners) listener("closed");
      await channel.write(`${JSON.stringify({ version: IPYTHON_PROTOCOL_VERSION, type: "shutdown" })}\n`);
      await channel.close();
    },
  };
}

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
  readonly approve: (effects: readonly IpPythonHostRequest[], blockDigest: string, binding?: IpPythonSessionBinding) => IpPythonBlockApproval | false | Promise<IpPythonBlockApproval | false>;
  /** Consume persisted repetition budgets before stage-two preparation or effects. */
  readonly consumeApproval?: (approval: IpPythonBlockApproval, effects: readonly IpPythonHostRequest[], binding?: IpPythonSessionBinding) => boolean | Promise<boolean>;
  readonly isFencingCurrent: (fencingToken: string) => boolean | Promise<boolean>;
  readonly isStopRequested: () => boolean | Promise<boolean>;
  readonly prepareEffect: (request: IpPythonHostRequest) => IpPythonPreparedEffect | Promise<IpPythonPreparedEffect>;
  /** Persist every applied and skipped effect outcome before returning. */
  readonly recordEffectResult: (index: number, request: IpPythonHostRequest, result: IpPythonExecutionResult, binding?: IpPythonSessionBinding) => void | Promise<void>;
  /** Persist each stage boundary, including empty and rejected stages. */
  readonly recordStageBoundary: (boundary: IpPythonStageBoundary, binding?: IpPythonSessionBinding) => void | Promise<void>;
}

function canonicalHostPayload(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalHostPayload).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalHostPayload(record[key])}`).join(",")}}`;
}

function hostEffectKey(request: IpPythonHostRequest): string {
  return `${request.method}:${canonicalHostPayload(request.payload)}`;
}

function blockDigest(request: IpPythonExecutionRequest, effects: readonly IpPythonHostRequest[]): string {
  return createHash("sha256").update(canonicalHostPayload({ request, effects: effects.map(hostEffectKey) }), "utf8").digest("hex");
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
  return unknownResult("partial_commit", `IPython effect queue applied ${appliedCount} effect(s) before ${reason}; outcome requires reconciliation`);
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
  const boundary = async (value: IpPythonStageBoundary): Promise<boolean> => {
    try { await options.recordStageBoundary(value, requestBinding); return true; }
    catch { journalFailed = true; return false; }
  };
  const effectRecord = async (index: number, effect: IpPythonHostRequest, result: IpPythonExecutionResult): Promise<boolean> => {
    try { await options.recordEffectResult(index, effect, result, requestBinding); return true; }
    catch { journalFailed = true; return false; }
  };
  const stopRequested = async (): Promise<boolean> => {
    try { return await options.isStopRequested(); }
    catch { return true; }
  };
  const fenceCurrent = async (): Promise<boolean> => {
    try { return await options.isFencingCurrent(options.fencingToken); }
    catch { return false; }
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
      try { await item.rollback(); }
      catch { rolledBack = false; }
    }
    return rolledBack;
  };
  const failJournal = async (stage: IpPythonStageBoundaryName, digest: string, intentCount: number, appliedCount: number, skippedCount: number): Promise<IpPythonExecutionResult> => {
    const rolledBack = await rollback();
    const skipped = await skip(queued, rolledBack ? "journal_failed" : "rollback_failed", appliedCount);
    const boundaryWritten = await boundary({ stage, outcome: "failed", sessionId: options.request.sessionId, fencingToken: options.fencingToken, blockDigest: digest, intentCount, appliedCount, skippedCount, reason: rolledBack ? "journal_failed" : "rollback_failed" });
    return !skipped || !boundaryWritten ? unknownResult("journal_failed") : unknownResult(rolledBack ? "journal_failed" : "rollback_failed");
  };

  let stageOne: IpPythonExecutionResult;
  try {
    stageOne = await options.runBlock(options.request, "collect", async (request) => { collected.push(request); return queuedHostResponse(); });
  } catch (error) {
    const digest = requestDigest(collected);
    const skipped = await skip(collected, "stage_one_failed");
    const boundaryWritten = await boundary({ stage: "collect", outcome: "failed", sessionId: options.request.sessionId, fencingToken: options.fencingToken, blockDigest: digest, intentCount: collected.length, appliedCount: 0, skippedCount: collected.length, reason: "stage_one_failed" });
    if (!skipped || !boundaryWritten) return unknownResult("journal_failed");
    return unknownResult("stage_one_failed", error instanceof Error ? error.message : String(error));
  }
  const collectedDigest = requestDigest(collected);
  const stageOneStopped = stageOne.state !== "ok" || await stopRequested();
  const collectBoundaryWritten = await boundary({ stage: "collect", outcome: stageOneStopped ? "stopped" : "completed", sessionId: options.request.sessionId, fencingToken: options.fencingToken, blockDigest: collectedDigest, intentCount: collected.length, appliedCount: 0, skippedCount: stageOneStopped ? collected.length : 0, ...(stageOneStopped ? { reason: stageOne.reason ?? "stop_requested" } : {}) });
  if (!collectBoundaryWritten) {
    await skip(collected, "journal_failed");
    return unknownResult("journal_failed");
  }
  if (stageOneStopped) {
    const skipped = await skip(collected, stageOne.state === "ok" ? "stop_requested" : "stage_one_stopped");
    if (!skipped) return unknownResult("journal_failed");
    return stageOne.state === "ok" ? { state: "cancelled", dataClass: "workspace", content: "IPython block stopped after collect", reason: "stop_requested" } : stageOne;
  }

  let approval: IpPythonBlockApproval | false;
  try { approval = await options.approve(collected, collectedDigest, requestBinding); }
  catch (error) {
    const skipped = await skip(collected, "approval_failed");
    const boundaryWritten = await boundary({ stage: "approval", outcome: "failed", sessionId: options.request.sessionId, fencingToken: options.fencingToken, blockDigest: collectedDigest, intentCount: collected.length, appliedCount: 0, skippedCount: collected.length, reason: "approval_failed" });
    if (!skipped || !boundaryWritten) return unknownResult("journal_failed");
    return unknownResult("approval_failed", error instanceof Error ? error.message : String(error));
  }
  const approvalRecord = approval !== false && approval !== null && typeof approval === "object" && typeof (approval as { approvalId?: unknown }).approvalId === "string" && typeof (approval as { blockDigest?: unknown }).blockDigest === "string" && typeof (approval as { fencingToken?: unknown }).fencingToken === "string" ? approval as IpPythonBlockApproval : undefined;
  if (approvalRecord === undefined || approvalRecord.approvalId.trim() === "" || approvalRecord.blockDigest !== collectedDigest || approvalRecord.fencingToken !== options.fencingToken) {
    const skipped = await skip(collected, "approval_rejected");
    const boundaryWritten = await boundary({ stage: "approval", outcome: "rejected", sessionId: options.request.sessionId, fencingToken: options.fencingToken, blockDigest: collectedDigest, intentCount: collected.length, appliedCount: 0, skippedCount: collected.length, reason: "approval_rejected" });
    if (!skipped || !boundaryWritten) return unknownResult("journal_failed");
    return errorResult("approval_rejected", "IPython block approval identity was rejected");
  }
  const approved = approvalRecord;
  if (!(await boundary({ stage: "approval", outcome: "completed", sessionId: options.request.sessionId, fencingToken: options.fencingToken, blockDigest: collectedDigest, approvedBlockDigest: approved.blockDigest, intentCount: collected.length, appliedCount: 0, skippedCount: 0 }))) {
    await skip(collected, "journal_failed");
    return unknownResult("journal_failed");
  }
  if (await stopRequested()) {
    const skipped = await skip(collected, "stop_requested");
    const boundaryWritten = await boundary({ stage: "execute", outcome: "stopped", sessionId: options.request.sessionId, fencingToken: options.fencingToken, blockDigest: collectedDigest, approvedBlockDigest: approved.blockDigest, intentCount: collected.length, appliedCount: 0, skippedCount: collected.length, reason: "stop_requested" });
    if (!skipped || !boundaryWritten) return unknownResult("journal_failed");
    return { state: "cancelled", dataClass: "workspace", content: "IPython block stopped before execute", reason: "stop_requested" };
  }
  if (!(await fenceCurrent())) {
    const skipped = await skip(collected, "stale_fencing_token");
    const boundaryWritten = await boundary({ stage: "execute", outcome: "stale", sessionId: options.request.sessionId, fencingToken: options.fencingToken, blockDigest: collectedDigest, approvedBlockDigest: approved.blockDigest, intentCount: collected.length, appliedCount: 0, skippedCount: collected.length, reason: "stale_fencing_token" });
    if (!skipped || !boundaryWritten) return unknownResult("journal_failed");
    return unknownResult("stale_fencing_token", "IPython block fencing token is stale");
  }

  let stageTwo: IpPythonExecutionResult;
  let stageTwoAbortReason: "stop_requested" | "stale_fencing_token" | undefined;
  try {
    stageTwo = await options.runBlock(options.request, "execute", async (request) => {
      const index = queued.length;
      queued.push(request);
      prepared.push(undefined);
      if (await stopRequested()) { stageTwoAbortReason = "stop_requested"; throw new Error(stageTwoAbortReason); }
      if (!(await fenceCurrent())) { stageTwoAbortReason = "stale_fencing_token"; throw new Error(stageTwoAbortReason); }
      const transaction = await options.prepareEffect(request);
      if (transaction.result.state !== "ok") throw new Error(transaction.result.reason ?? "prepared effect was not successful");
      prepared[index] = transaction;
      return transaction.result;
    });
  } catch (error) {
    const reason = stageTwoAbortReason ?? "stage_two_failed";
    const rolledBack = await rollback();
    const skipped = await skip(queued, rolledBack ? reason : "rollback_failed");
    const boundaryWritten = await boundary({ stage: "execute", outcome: rolledBack && reason !== "stage_two_failed" ? (reason === "stop_requested" ? "stopped" : "stale") : "failed", sessionId: options.request.sessionId, fencingToken: options.fencingToken, blockDigest: requestDigest(queued), approvedBlockDigest: approved.blockDigest, intentCount: queued.length, appliedCount: 0, skippedCount: queued.length, reason: rolledBack ? reason : "rollback_failed" });
    if (!skipped || !boundaryWritten) return unknownResult("journal_failed");
    return unknownResult(rolledBack ? reason : "rollback_failed", error instanceof Error ? error.message : String(error));
  }
  const stageTwoDigest = requestDigest(queued);
  if (stageTwo.state !== "ok") {
    const reason = stageTwoAbortReason ?? stageTwo.reason ?? "stage_two_stopped";
    const rolledBack = await rollback();
    const skipped = await skip(queued, rolledBack ? reason : "rollback_failed");
    const boundaryWritten = await boundary({ stage: "execute", outcome: rolledBack ? (reason === "stale_fencing_token" ? "stale" : "stopped") : "failed", sessionId: options.request.sessionId, fencingToken: options.fencingToken, blockDigest: stageTwoDigest, approvedBlockDigest: approved.blockDigest, intentCount: queued.length, appliedCount: 0, skippedCount: queued.length, reason: rolledBack ? reason : "rollback_failed" });
    if (!skipped || !boundaryWritten) return unknownResult("journal_failed");
    return rolledBack ? stageTwo : unknownResult("rollback_failed");
  }
  if (stageTwoDigest !== approved.blockDigest || collected.length !== queued.length || prepared.some((item) => item === undefined) || collected.some((request, index) => hostEffectKey(request) !== hostEffectKey(queued[index]!))) {
    const rolledBack = await rollback();
    const skipped = await skip(queued, rolledBack ? "stage_divergence" : "rollback_failed");
    const boundaryWritten = await boundary({ stage: "execute", outcome: rolledBack ? "diverged" : "failed", sessionId: options.request.sessionId, fencingToken: options.fencingToken, blockDigest: stageTwoDigest, approvedBlockDigest: approved.blockDigest, intentCount: queued.length, appliedCount: 0, skippedCount: queued.length, reason: rolledBack ? "stage_divergence" : "rollback_failed" });
    if (!skipped || !boundaryWritten) return unknownResult("journal_failed");
    return rolledBack ? errorResult("stage_divergence", "IPython block effect set changed between stages") : unknownResult("rollback_failed");
  }
  if (!(await boundary({ stage: "execute", outcome: "completed", sessionId: options.request.sessionId, fencingToken: options.fencingToken, blockDigest: stageTwoDigest, approvedBlockDigest: approved.blockDigest, intentCount: queued.length, appliedCount: 0, skippedCount: 0 }))) {
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
      const reason = stop ? "stop_requested" : "stale_fencing_token";
      const rolledBack = await rollback();
      const skipped = await skip(queued, rolledBack ? reason : "rollback_failed", index);
      const boundaryWritten = await boundary({ stage: "commit", outcome: rolledBack ? (stop ? "stopped" : "stale") : "failed", sessionId: options.request.sessionId, fencingToken: options.fencingToken, blockDigest: stageTwoDigest, approvedBlockDigest: approved.blockDigest, intentCount: queued.length, appliedCount, skippedCount: queued.length - index, reason: rolledBack ? reason : "rollback_failed" });
      if (!skipped || !boundaryWritten) return unknownResult("journal_failed");
      if (!rolledBack) return unknownResult("rollback_failed");
      return appliedCount > 0 ? partialCommitResult(appliedCount, reason) : (stop ? { state: "cancelled", dataClass: "workspace", content: `IPython effect queue stopped after ${appliedCount} effect(s)`, reason } : unknownResult(reason, `IPython effect queue stopped after ${appliedCount} effect(s)`));
    }
    if (!approvalConsumed) {
      let consumed = false;
      try { consumed = await options.consumeApproval!(approved, collected, requestBinding); } catch { consumed = false; }
      if (!consumed) {
        const skipped = await skip(collected, "approval_consumption_rejected");
        const boundaryWritten = await boundary({ stage: "execute", outcome: "rejected", sessionId: options.request.sessionId, fencingToken: options.fencingToken, blockDigest: collectedDigest, approvedBlockDigest: approved.blockDigest, intentCount: collected.length, appliedCount: 0, skippedCount: collected.length, reason: "approval_consumption_rejected" });
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
      result = await item.commit({ fencingToken: options.fencingToken, assertValid: async () => {
        if (await stopRequested()) throw new Error("stop_requested");
        if (!(await fenceCurrent())) throw new Error("stale_fencing_token");
        leaseValidated = true;
      } });
      if (!leaseValidated) result = unknownResult("unvalidated_commit", "IPython effect commit did not validate its fencing lease");
    }
    catch (error) { result = unknownResult(error instanceof Error && ["stop_requested", "stale_fencing_token"].includes(error.message) ? error.message : "effect_failed", error instanceof Error ? error.message : String(error)); }
    if (!(await effectRecord(index, queued[index]!, result))) return failJournal("commit", stageTwoDigest, queued.length, appliedCount, queued.length - index);
    if (result.state !== "ok") {
      const rolledBack = await rollback();
      const skipped = await skip(queued, rolledBack ? "effect_failed" : "rollback_failed", index + 1);
      const boundaryWritten = await boundary({ stage: "commit", outcome: rolledBack ? "failed" : "failed", sessionId: options.request.sessionId, fencingToken: options.fencingToken, blockDigest: stageTwoDigest, approvedBlockDigest: approved.blockDigest, intentCount: queued.length, appliedCount, skippedCount: queued.length - index - 1, reason: rolledBack ? "effect_failed" : "rollback_failed" });
      if (!skipped || !boundaryWritten) return unknownResult("journal_failed");
      if (appliedCount > 0) return partialCommitResult(appliedCount, "an effect failed");
      if (result.reason === "stop_requested" || result.reason === "stale_fencing_token" || result.reason === "authority_or_boundary_rejected") return result;
      return unknownResult("effect_outcome_unknown", `IPython effect commit failed before a durable outcome was established: ${result.reason ?? "unknown"}`);
    }
    committed.add(index);
    finalCommitResult = result;
    appliedCount += 1;
  }
  if (!(await boundary({ stage: "commit", outcome: "completed", sessionId: options.request.sessionId, fencingToken: options.fencingToken, blockDigest: stageTwoDigest, approvedBlockDigest: approved.blockDigest, intentCount: queued.length, appliedCount, skippedCount: 0 }))) return unknownResult("journal_failed");
  if (journalFailed) return unknownResult("journal_failed");
  return { ...finalCommitResult, content: stageTwo.content === "" ? finalCommitResult.content : stageTwo.content, ...(stageTwo.truncated === undefined ? {} : { truncated: stageTwo.truncated }) };

}

export interface IpPythonKernelOptions {
  readonly transport: IpPythonTransport;
  readonly hostRequest: (request: IpPythonHostRequest, binding?: IpPythonSessionBinding) => IpPythonExecutionResult | Promise<IpPythonExecutionResult>;
  readonly onEvent?: (event: Pick<IpPythonEventFrame, "requestId" | "stream" | "text">) => void;
  /** Maximum time allowed for a cooperative interrupt before the child is closed. */
  readonly interruptGraceMs?: number;
  /** Require a version-checked child ready frame before the first cell. */
  readonly requireReady?: boolean;
  readonly readyTimeoutMs?: number;
}

export type IpPythonHostBinding = IpPythonSessionBinding;

export interface IpPythonReadOnlyGateway {
  readFile(binding: IpPythonHostBinding, relativePath: string): IpPythonExecutionResult | Promise<IpPythonExecutionResult>;
  gitRevision(binding: IpPythonHostBinding, ref: string): IpPythonExecutionResult | Promise<IpPythonExecutionResult>;
}

export interface IpPythonReadOnlyValueAdapters {
  readFile(binding: IpPythonHostBinding, relativePath: string): string | Promise<string>;
  gitRevision(binding: IpPythonHostBinding, ref: string): string | Promise<string>;
}

/** Adapt already-authorized file/Git ports into the host protocol result envelope. */
export function createIpPythonReadOnlyGateway(adapters: IpPythonReadOnlyValueAdapters): IpPythonReadOnlyGateway {
  return {
    async readFile(_binding, relativePath) { return { state: "ok", dataClass: "workspace", content: await adapters.readFile(_binding, relativePath) }; },
    async gitRevision(_binding, ref) { return { state: "ok", dataClass: "workspace", content: await adapters.gitRevision(_binding, ref) }; },
  };
}

export class IpPythonProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IpPythonProtocolError";
  }
}

export class IpPythonKernelBusyError extends Error {
  constructor() {
    super("IPython kernel is busy");
    this.name = "IpPythonKernelBusyError";
  }
}

export interface IpPythonParentWatchdog {
  start(): void;
  stop(): void;
  checkNow(): Promise<void>;
}

export interface IpPythonParentWatchdogOptions {
  readonly parentPid: number;
  /** Stable OS identity captured for the expected parent PID; prevents PID reuse. */
  readonly parentIdentity: string;
  readonly intervalMs?: number;
  readonly isAlive?: (parentPid: number) => boolean | Promise<boolean>;
  readonly readIdentity?: (parentPid: number) => string | Promise<string>;
  /** Must terminate the complete owned process group, not only the leader. */
  readonly terminate: (reason: "parent_dead" | "parent_identity_mismatch" | "parent_liveness_unknown") => void | Promise<void>;
}

export function readIpPythonParentIdentity(parentPid: number): string {
  try {
    const stat = readFileSync(`/proc/${parentPid}/stat`, "utf8");
    const commandEnd = stat.lastIndexOf(")");
    const fields = commandEnd < 0 ? [] : stat.slice(commandEnd + 2).trim().split(/\s+/);
    const startTime = fields[19];
    if (startTime === undefined || startTime === "") throw new Error("process start time is unavailable");
    return startTime;
  } catch { throw new Error("IPython parent identity is unavailable"); }
}

function defaultParentIsAlive(parentPid: number): boolean {
  try { process.kill(parentPid, 0); return true; }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") return false;
    throw error;
  }
}

export function createIpPythonParentWatchdog(options: IpPythonParentWatchdogOptions): IpPythonParentWatchdog {
  if (!Number.isSafeInteger(options.parentPid) || options.parentPid <= 0) throw new Error("IPython parent PID is invalid");
  if (typeof options.parentIdentity !== "string" || options.parentIdentity.trim() === "") throw new Error("IPython parent identity is required");
  const intervalMs = options.intervalMs ?? 500;
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) throw new Error("IPython parent watchdog interval is invalid");
  const isAlive = options.isAlive ?? defaultParentIsAlive;
  const readIdentity = options.readIdentity ?? readIpPythonParentIdentity;
  let timer: ReturnType<typeof setInterval> | undefined;
  let triggered = false;
  let checkInFlight = false;
  const stop = () => { if (timer !== undefined) { clearInterval(timer); timer = undefined; } };
  const checkNow = async () => {
    if (triggered || checkInFlight) return;
    checkInFlight = true;
    try {
      let alive: boolean;
      try { alive = await isAlive(options.parentPid); }
      catch { triggered = true; stop(); await options.terminate("parent_liveness_unknown"); return; }
      if (!alive) {
        triggered = true;
        stop();
        await options.terminate("parent_dead");
        return;
      }
      let identity: string;
      try { identity = await readIdentity(options.parentPid); }
      catch { triggered = true; stop(); await options.terminate("parent_liveness_unknown"); return; }
      if (identity === options.parentIdentity) return;
      triggered = true;
      stop();
      await options.terminate("parent_identity_mismatch");
    } finally { checkInFlight = false; }
  };
  return {
    start() { if (timer === undefined && !triggered) { timer = setInterval(() => { void checkNow(); }, intervalMs); timer.unref?.(); } },
    stop,
    checkNow,
  };
}


function payloadRecord(payload: unknown): Record<string, unknown> {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) throw new IpPythonProtocolError("IPython host payload must be an object");
  return payload as Record<string, unknown>;
}

function relativeReadPath(value: unknown): string {
  const path = requiredString(value, "path");
  if (path.includes("\\") || path.startsWith("/") || path.split("/").some((part) => part === "..")) throw new IpPythonProtocolError("IPython read path is outside the Goal scope");
  return path;
}

function gitRef(value: unknown): string {
  const ref = requiredString(value, "ref");
  if (ref.includes("\0") || /\s/.test(ref)) throw new IpPythonProtocolError("IPython Git ref is invalid");
  return ref;
}

function validateHostResult(value: IpPythonExecutionResult, binding: IpPythonHostBinding): IpPythonExecutionResult {
  if (value === null || typeof value !== "object" || !["ok", "error", "cancelled", "unknown"].includes(value.state) || typeof value.content !== "string" || !["public", "workspace", "private", "pii", "phi", "secret"].includes(value.dataClass)) throw new IpPythonProtocolError("IPython host result is invalid");
  if (!binding.outboundDataClasses.includes(value.dataClass)) throw new IpPythonProtocolError("IPython host result data class is outside the Goal scope");
  if (Buffer.byteLength(value.content, "utf8") > MAX_FRAME_BYTES) throw new IpPythonProtocolError("IPython host result exceeds the output limit");
  return value;
}

function stableBindingKey(binding: IpPythonHostBinding): string {
  const { admissionCommandId: _admissionCommandId, commandId: _commandId, toolCallId: _toolCallId, ...stableBinding } = binding;
  return JSON.stringify(stableBinding);
}

export function createReadOnlyHostRequestHandler(options: { readonly binding: IpPythonHostBinding; readonly gateway: IpPythonReadOnlyGateway }): (request: IpPythonHostRequest, binding?: IpPythonHostBinding) => Promise<IpPythonExecutionResult> {
  return async (request, requestBinding) => {
    const binding = requestBinding ?? options.binding;
    if (stableBindingKey(binding) !== stableBindingKey(options.binding)) throw new IpPythonProtocolError("IPython host binding identity changed");
    const payload = payloadRecord(request.payload);
    if (request.method === "read_file") return validateHostResult(await options.gateway.readFile(binding, relativeReadPath(payload.path)), binding);
    if (request.method === "git_revision") return validateHostResult(await options.gateway.gitRevision(binding, gitRef(payload.ref)), binding);
    throw new IpPythonProtocolError(`IPython host method is not allowed: ${request.method}`);
  };
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new IpPythonProtocolError("IPython frame must be an object");
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new IpPythonProtocolError(`IPython frame ${name} is required`);
  return value;
}

function dataClass(value: unknown): DataClass {
  if (!["public", "workspace", "private", "pii", "phi", "secret"].includes(value as string)) throw new IpPythonProtocolError("IPython frame data class is invalid");
  return value as DataClass;
}

function executionState(value: unknown): IpPythonExecutionResult["state"] {
  if (!["ok", "error", "cancelled", "unknown"].includes(value as string)) throw new IpPythonProtocolError("IPython frame execution state is invalid");
  return value as IpPythonExecutionResult["state"];
}

export function parseIpPythonFrame(value: unknown): IpPythonFrame {
  const input = record(value);
  if (input.version !== IPYTHON_PROTOCOL_VERSION) throw new IpPythonProtocolError("IPython protocol version is unsupported");
  const type = input.type;
  if (type === "ready") {
    if (input.runtime !== "python") throw new IpPythonProtocolError("IPython runtime is unsupported");
    return { version: IPYTHON_PROTOCOL_VERSION, type, runtime: "python" };
  }
  if (type === "execute") {
    return { version: IPYTHON_PROTOCOL_VERSION, type, requestId: requiredString(input.requestId, "requestId"), sessionId: requiredString(input.sessionId, "sessionId"), code: requiredString(input.code, "code") };
  }
  if (type === "host_request") {
    return { version: IPYTHON_PROTOCOL_VERSION, type, requestId: requiredString(input.requestId, "requestId"), hostRequestId: requiredString(input.hostRequestId, "hostRequestId"), method: requiredString(input.method, "method"), payload: input.payload };
  }
  if (type === "done") {
    const content = typeof input.content === "string" ? input.content : (() => { throw new IpPythonProtocolError("IPython frame content is required"); })();
    if (input.truncated !== undefined && typeof input.truncated !== "boolean") throw new IpPythonProtocolError("IPython frame truncation flag is invalid");
    return { version: IPYTHON_PROTOCOL_VERSION, type, requestId: requiredString(input.requestId, "requestId"), state: executionState(input.state), dataClass: dataClass(input.dataClass), content, ...(input.reason === undefined ? {} : { reason: requiredString(input.reason, "reason") }), ...(input.truncated === undefined ? {} : { truncated: input.truncated }) };
  }
  if (type === "interrupt") return { version: IPYTHON_PROTOCOL_VERSION, type, requestId: requiredString(input.requestId, "requestId") };
  if (type === "shutdown") return { version: IPYTHON_PROTOCOL_VERSION, type };
  if (type === "event") {
    const stream = input.stream;
    if (stream !== "stdout" && stream !== "stderr") throw new IpPythonProtocolError("IPython event stream is invalid");
    return { version: IPYTHON_PROTOCOL_VERSION, type, requestId: requiredString(input.requestId, "requestId"), stream, text: typeof input.text === "string" ? input.text : (() => { throw new IpPythonProtocolError("IPython event text is required"); })() };
  }
  if (type === "error") return { version: IPYTHON_PROTOCOL_VERSION, type, requestId: requiredString(input.requestId, "requestId"), reason: requiredString(input.reason, "reason") };
  if (type === "host_response") {
    if (typeof input.ok !== "boolean") throw new IpPythonProtocolError("IPython host response status is invalid");
    return { version: IPYTHON_PROTOCOL_VERSION, type, requestId: requiredString(input.requestId, "requestId"), hostRequestId: requiredString(input.hostRequestId, "hostRequestId"), ok: input.ok, ...(input.result === undefined ? {} : { result: input.result as IpPythonExecutionResult }), ...(input.error === undefined ? {} : { error: requiredString(input.error, "error") }) };
  }
  throw new IpPythonProtocolError("IPython frame type is unsupported");
}

export interface IpPythonProcessKernelOptions extends Omit<IpPythonKernelOptions, "transport"> {
  readonly createProcess: (sessionId: string, binding?: IpPythonSessionBinding) => IpPythonLineChannel;
  readonly parentWatchdog?: IpPythonParentWatchdog;
}

export function createIpPythonProcessKernel(options: IpPythonProcessKernelOptions, sessionId: string, binding?: IpPythonSessionBinding): IpPythonKernel {
  const channel = options.createProcess(sessionId, binding);
  const processReady = (channel as IpPythonLineChannel & { readonly ready?: Promise<void> }).ready;
  const kernel = createIpPythonKernel({ transport: createIpPythonJsonLinesTransport(channel), hostRequest: options.hostRequest, requireReady: true, ...(options.interruptGraceMs === undefined ? {} : { interruptGraceMs: options.interruptGraceMs }), ...(options.readyTimeoutMs === undefined ? {} : { readyTimeoutMs: options.readyTimeoutMs }), ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }) });
  options.parentWatchdog?.start();
  return {
    execute: processReady === undefined ? kernel.execute : async (request) => {
      try {
        await processReady;
      } catch (error) {
        await Promise.resolve(channel.close()).catch(() => undefined);
        throw error;
      }
      return kernel.execute(request);
    },
    ...(kernel.interrupt === undefined ? {} : { interrupt: kernel.interrupt }),
    async close() { options.parentWatchdog?.stop(); await kernel.close?.(); },
  };
}

interface PendingCell {
  readonly requestId: string;
  readonly sessionId: string;
  readonly binding?: IpPythonSessionBinding;
  readonly resolve: (result: IpPythonExecutionResult) => void;
  readonly reject: (error: unknown) => void;
}

export function createIpPythonKernel(options: IpPythonKernelOptions): IpPythonKernel {
  let active: PendingCell | undefined;
  let interruptTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let ready = options.requireReady !== true;
  let resolveReady: (() => void) | undefined;
  let rejectReady: ((error: unknown) => void) | undefined;
  const readyPromise = ready ? Promise.resolve() : new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const clearInterruptTimer = () => { if (interruptTimer !== undefined) { clearTimeout(interruptTimer); interruptTimer = undefined; } };
  const takeActive = () => { const pending = active; active = undefined; clearInterruptTimer(); return pending; };
  const removeFrameListener = options.transport.onFrame((raw) => {
    let frame: IpPythonFrame;
    try { frame = parseIpPythonFrame(raw); } catch (error) {
      if (!ready) { rejectReady?.(error); rejectReady = undefined; resolveReady = undefined; }
      const pending = takeActive();
      pending?.reject(error);
      return;
    }
    if (frame.type === "ready") {
      ready = true;
      resolveReady?.();
      resolveReady = undefined;
      rejectReady = undefined;
      return;
    }
    if (frame.type === "host_request") {
      if (active === undefined || active.requestId !== frame.requestId) return;
      Promise.resolve(options.hostRequest({ requestId: frame.requestId, hostRequestId: frame.hostRequestId, method: frame.method, payload: frame.payload }, active.binding)).then((result) => options.transport.send({ version: IPYTHON_PROTOCOL_VERSION, type: "host_response", requestId: frame.requestId, hostRequestId: frame.hostRequestId, ok: true, result })).catch((error) => options.transport.send({ version: IPYTHON_PROTOCOL_VERSION, type: "host_response", requestId: frame.requestId, hostRequestId: frame.hostRequestId, ok: false, error: error instanceof Error ? error.message : String(error) }));
      return;
    }
    if (frame.type !== "event" && frame.type !== "done" && frame.type !== "error") return;
    if (active === undefined || frame.requestId !== active.requestId) return;
    if (frame.type === "event") { options.onEvent?.(frame); return; }
    if (frame.type === "done") { const pending = takeActive(); pending?.resolve({ state: frame.state, dataClass: frame.dataClass, content: frame.content, ...(frame.reason === undefined ? {} : { reason: frame.reason }), ...(frame.truncated === undefined ? {} : { truncated: frame.truncated }) }); return; }
    if (frame.type === "error") { const pending = takeActive(); pending?.resolve({ state: "unknown", dataClass: "workspace", content: frame.reason, reason: frame.reason }); }
  });
  const removeCloseListener = options.transport.onClose((reason) => {
    if (!ready) { rejectReady?.(new Error(reason ?? "IPython child closed before ready")); rejectReady = undefined; resolveReady = undefined; }
    if (active === undefined) return;
    const pending = takeActive();
    pending?.resolve({ state: "unknown", dataClass: "workspace", content: reason ?? "IPython child closed", reason: "child_closed" });
  });

  return {
    async execute(request: IpPythonExecutionRequest): Promise<IpPythonExecutionResult> {
      if (closed) throw new Error("IPython kernel is closed");
      if (!ready) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([readyPromise, new Promise<void>((_, reject) => { timer = setTimeout(() => reject(new Error("handshake_timeout")), options.readyTimeoutMs ?? 5_000); })]);
        } catch {
          return { state: "unknown", dataClass: "workspace", content: "IPython child did not complete the ready handshake", reason: "handshake_timeout" };
        } finally { if (timer !== undefined) clearTimeout(timer); }
      }
      if (active !== undefined) throw new IpPythonKernelBusyError();
      const requestId = `cell-${randomUUID()}`;
      const result = new Promise<IpPythonExecutionResult>((resolve, reject) => { active = { requestId, sessionId: request.sessionId, ...(request.binding === undefined ? {} : { binding: request.binding }), resolve, reject }; });
      try {
        await options.transport.send({ version: IPYTHON_PROTOCOL_VERSION, type: "execute", requestId, sessionId: request.sessionId, code: request.code });
      } catch (error) {
        const pending = takeActive();
        if (pending !== undefined) pending.reject(error);
      }
      return result;
    },
    async interrupt(sessionId: string): Promise<void> {
      if (active?.sessionId !== sessionId) return;
      await options.transport.interrupt(active.requestId);
      if (active?.sessionId === sessionId) {
        const graceMs = options.interruptGraceMs ?? 250;
        interruptTimer = setTimeout(() => { void options.transport.close(); }, graceMs);
      }
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      const pending = takeActive();
      if (pending !== undefined) pending.resolve({ state: "unknown", dataClass: "workspace", content: "IPython kernel closed", reason: "kernel_closed" });
      removeFrameListener();
      removeCloseListener();
      await options.transport.close();
    },
  };
}
