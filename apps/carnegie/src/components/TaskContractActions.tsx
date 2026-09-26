import React, { useEffect, useState } from "react";
import type { OvertureRun, TaskContract } from "@maestro/contracts";
import { useGoals } from "../goals.js";
import { confirmTaskContractDraft, launchTaskContractDraft } from "../lib/task-contract-authoring.js";
import { selectGoalAfterLaunch } from "../lib/goal-operations.js";

/**
 * Create → confirm → launch for the Task Contract drafted from task.md at the
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
  const contractId = run?.taskContractId ?? undefined;

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

  const create = () =>
    act(async () => {
      if (run === undefined || revision === undefined) throw new Error("The Overture crew has not written this workspace yet");
      setContract(
        await window.maestro.api.createOvertureWorkspaceTaskContract(
          run.runId,
          { projectId, conversationId: run.conversationId, revision },
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
      {!launched && contract === undefined && (
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || run === undefined || revision === undefined} onClick={() => void create()}>
          create contract
        </button>
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
