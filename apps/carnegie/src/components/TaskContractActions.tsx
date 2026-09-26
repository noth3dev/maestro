import React, { useEffect, useState } from "react";
import type { OvertureReviewGate, OvertureRun, TaskContract } from "@maestro/contracts";
import { useGoals } from "../goals.js";
import { confirmTaskContractDraft, launchTaskContractDraft } from "../lib/task-contract-authoring.js";
import { selectGoalAfterLaunch } from "../lib/goal-operations.js";

/**
 * Create → confirm → launch for the Task Contract drafted from prd.md at the
 * workspace revision the operator is looking at.
 */
export function TaskContractActions({
  projectId,
  run,
  revision,
  onChanged,
}: {
  projectId: string;
  run: OvertureRun | undefined;
  revision: string | undefined;
  onChanged: () => void;
}) {
  const { selectGoal, refresh: refreshGoals } = useGoals();
  const [contract, setContract] = useState<TaskContract | undefined>(undefined);
  const [confirmed, setConfirmed] = useState(false);
  const [launchedGoalId, setLaunchedGoalId] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [gate, setGate] = useState<OvertureReviewGate | undefined>(undefined);
  const contractId = run?.taskContractId ?? undefined;

  // Re-evaluate the plan review gate whenever the workspace changes.
  useEffect(() => {
    if (run === undefined || contractId !== undefined) return;
    let current = true;
    void window.maestro.api
      .getOvertureReviewGate(run.runId, { projectId, conversationId: run.conversationId })
      .then((value) => { if (current) setGate(value); })
      .catch(() => { if (current) setGate(undefined); });
    return () => { current = false; };
  }, [contractId, projectId, revision, run?.runId, run?.conversationId]);

  useEffect(() => {
    if (contractId === undefined) {
      setContract(undefined);
      return;
    }
    let current = true;
    void window.maestro.api
      .getTaskContract(contractId, { projectId })
      .then((value) => { if (current) setContract(value); })
      .catch((cause: unknown) => { if (current) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { current = false; };
  }, [contractId, projectId]);

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const create = (acceptReviewBlockers: boolean) =>
    act(async () => {
      if (run === undefined || revision === undefined) throw new Error("The Overture crew has not written this workspace yet");
      setContract(
        await window.maestro.api.createOvertureWorkspaceTaskContract(
          run.runId,
          { projectId, conversationId: run.conversationId, revision, ...(acceptReviewBlockers ? { acceptReviewBlockers: true } : {}) },
          { idempotencyKey: globalThis.crypto.randomUUID() },
        ),
      );
      onChanged();
    });

  const confirm = () =>
    act(async () => {
      if (contract === undefined) return;
      await confirmTaskContractDraft(window.maestro.api, contract);
      setConfirmed(true);
    });

  const launch = () =>
    act(async () => {
      if (contract === undefined) return;
      const result = await launchTaskContractDraft(window.maestro.api, contract);
      setContract(result.taskContract);
      setLaunchedGoalId(result.goalId);
      await selectGoalAfterLaunch({ refreshGoals }, { goalId: result.goalId }, selectGoal);
      onChanged();
    });

  const launched = contract?.launchState === "launched" || launchedGoalId !== undefined;
  const pinned = run?.taskContractRef !== null && run?.taskContractRef !== undefined && "workspaceRevision" in run.taskContractRef
    ? run.taskContractRef.workspaceRevision
    : undefined;
  const stale = pinned !== undefined && revision !== undefined && pinned !== revision;

  return (
    <div className="task-actions" role="group" aria-label="Task Contract">
      <span className="task-actions-state">
        {launched
          ? `launched${launchedGoalId === undefined ? "" : ` · goal ${launchedGoalId.slice(0, 8)}`}`
          : contract === undefined
            ? "no Task Contract yet"
            : confirmed
              ? "confirmed · ready to launch"
              : `contract drafted${pinned === undefined ? "" : ` from ${pinned.slice(0, 8)}`}${stale ? " · workspace changed since" : ""}`}
      </span>
      {!launched && contract === undefined && gate !== undefined && (
        <span className={`task-gate task-gate-${gate.state}`} title={gate.state === "passed" ? undefined : gate.reason}>
          {gate.state === "passed" ? "plan review passed" : gate.state === "blocked" ? `${gate.blockers.length} review blocker(s)` : gate.state === "stale" ? "review out of date" : gate.state === "self_review" ? "self-reviewed" : "not reviewed yet"}
        </span>
      )}
      {!launched && contract === undefined && gate?.state === "passed" && (
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || run === undefined || revision === undefined} onClick={() => void create(false)}>
          create contract
        </button>
      )}
      {!launched && contract === undefined && gate !== undefined && gate.state !== "passed" && (
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy || run === undefined || revision === undefined}
          title="Creates the contract anyway; your acceptance is recorded as evidence."
          onClick={() => void create(true)}
        >
          accept and create
        </button>
      )}
      {!launched && contract === undefined && gate !== undefined && gate.state !== "passed" && (
        <p className="task-gate-reason">
          {gate.reason}
          {gate.state === "blocked" && (
            <>
              {": "}
              {gate.blockers.join("; ")}
            </>
          )}
        </p>
      )}
      {!launched && contract !== undefined && !confirmed && (
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void confirm()}>
          confirm
        </button>
      )}
      {!launched && contract !== undefined && (
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || !confirmed} onClick={() => void launch()}>
          launch
        </button>
      )}
      {error !== undefined && <span className="task-actions-error" role="alert">{error}</span>}
    </div>
  );
}
