import React, { useEffect, useState } from "react";
import type { OvertureReviewGate, OvertureRun, TaskContract } from "@maestro/contracts";
import { useGoals } from "../goals.js";
import { confirmTaskContractDraft, launchTaskContractDraft } from "../lib/task-contract-authoring.js";
import { selectGoalAfterLaunch } from "../lib/goal-operations.js";
import { projectName, useProjects } from "../projects.js";

/** The PRD's first `# ` heading without a trailing "PRD" label, as a project name. */
export function prdProjectName(markdown: string): string {
  const heading = /^#\s+(.+)$/m.exec(markdown)?.[1] ?? "";
  const name = heading.replace(/\s*[—–:-]\s*PRD\s*$/i, "").replace(/^PRD\s*[—–:-]\s*/i, "").replace(/^(PRD|product requirements( document)?)$/i, "").trim();
  return name.slice(0, 120) || "New project";
}

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
  const { projects, homeProjectId, selectProject, refresh: refreshProjects } = useProjects();
  // A PRD approved in Home starts a new project; inside a project it defaults to that project.
  const [target, setTarget] = useState<"new" | "this">(projectId === homeProjectId ? "new" : "this");
  const [newName, setNewName] = useState<string | undefined>(undefined);
  const contractProjectId = run?.targetProjectId ?? projectId;
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
      .getTaskContract(contractId, { projectId: contractProjectId })
      .then((value) => { if (current) setContract(value); })
      .catch((cause: unknown) => { if (current) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { current = false; };
  }, [contractId, contractProjectId]);

  // Suggest the new project's name from the PRD title.
  useEffect(() => {
    if (run === undefined || contractId !== undefined || newName !== undefined) return;
    let current = true;
    void window.maestro.api
      .readSessionWorkspaceFile(run.conversationId, { projectId, path: "prd.md" })
      .then((file) => { if (current) setNewName((name) => name ?? prdProjectName(file.content)); })
      .catch(() => undefined);
    return () => { current = false; };
  }, [contractId, newName, projectId, revision, run]);

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
          {
            projectId,
            conversationId: run.conversationId,
            revision,
            ...(acceptReviewBlockers ? { acceptReviewBlockers: true } : {}),
            ...(target === "new" ? { target: { kind: "new" as const, name: (newName ?? "").trim() || "New project" } } : {}),
          },
          { idempotencyKey: globalThis.crypto.randomUUID() },
        ),
      );
      // A new project may have been created for this Goal.
      await refreshProjects();
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
      if (result.taskContract.project.projectId !== projectId) {
        // Follow the Goal into its project; that project's Goals load there.
        await refreshProjects();
        selectProject(result.taskContract.project.projectId);
      } else {
        await selectGoalAfterLaunch({ refreshGoals }, { goalId: result.goalId }, selectGoal);
      }
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
      {!launched && contract === undefined && gate !== undefined && (
        <fieldset className="task-target">
          <legend>Goal starts in</legend>
          <label>
            <input type="radio" name="task-target" checked={target === "new"} onChange={() => setTarget("new")} />
            new project
            <input
              type="text"
              aria-label="New project name"
              maxLength={120}
              value={newName ?? ""}
              placeholder="Project name"
              onFocus={() => setTarget("new")}
              onChange={(event) => setNewName(event.target.value)}
            />
          </label>
          <label>
            <input type="radio" name="task-target" checked={target === "this"} onChange={() => setTarget("this")} />
            {projectName(projects, projectId)}
          </label>
        </fieldset>
      )}
      {contract !== undefined && contractProjectId !== projectId && (
        <span className="task-actions-state">→ {projectName(projects, contractProjectId)}</span>
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
