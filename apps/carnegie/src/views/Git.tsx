import React, { useEffect, useState } from "react";
import type {
  Certification,
  DepartmentAcceptance,
  DepartmentBranch,
  EvidenceBundleRead,
  IntegrationCommit,
  WorkerWorktree,
} from "@maestro/contracts";
import { Icon } from "../icons.js";
import { EmptyState } from "../components/EmptyState.js";
import { useConnection } from "../connection.js";
import { useGoals } from "../goals.js";
import { useGitIntegrationState } from "../useGitIntegrationState.js";
import {
  advanceWorkerIntegrationFromRevision,
  createDepartmentBranch,
  createGoalIntegrationBranch,
  createWorkerWorktree,
  freezeGoalIntegrationRevisionFromBranch,
  getEvidenceBundle,
  listCertifications,
} from "../lib/integration-data.js";
import { newCommandId } from "../lib/command-id.js";
import { WorkerReview } from "./WorkerReview.js";

interface BranchForm {
  repositoryPath: string;
  branchName: string;
  baseRevision: string;
}

function splitEvidenceReferences(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

export function Git({ onBack }: { onBack: () => void }) {
  const { config } = useConnection();
  const { selectedGoalId } = useGoals();
  const { state, loading, error, refresh } = useGitIntegrationState();
  const [goalBranch, setGoalBranch] = useState<BranchForm>({ repositoryPath: "", branchName: "", baseRevision: "" });
  const [councilId, setCouncilId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [departmentBranch, setDepartmentBranch] = useState<DepartmentBranch | undefined>(undefined);
  const [workerId, setWorkerId] = useState("");
  const [worktreePath, setWorktreePath] = useState("");
  const [worktreeRepositoryPath, setWorktreeRepositoryPath] = useState("");
  const [workerWorktree, setWorkerWorktree] = useState<WorkerWorktree | undefined>(undefined);
  const [integrationMessage, setIntegrationMessage] = useState("");
  const [evidenceReferences, setEvidenceReferences] = useState("");
  const [integrationCommit, setIntegrationCommit] = useState<IntegrationCommit | undefined>(undefined);
  const [acceptance, setAcceptance] = useState<DepartmentAcceptance | undefined>(undefined);
  const [evidenceBundle, setEvidenceBundle] = useState<EvidenceBundleRead | undefined>(undefined);
  const [certifications, setCertifications] = useState<readonly Certification[]>([]);
  const [evidenceError, setEvidenceError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [rejectionReason, setRejectionReason] = useState<string | undefined>(undefined);

  useEffect(() => {
    setIntegrationCommit(undefined);
    setAcceptance(undefined);
    setWorkerWorktree(undefined);
    setDepartmentBranch(undefined);
    setEvidenceBundle(undefined);
    setCertifications([]);
    setEvidenceError(undefined);
    if (config === undefined || selectedGoalId === undefined) return;
    let active = true;
    void Promise.all([
      getEvidenceBundle(window.maestro.api, selectedGoalId, { projectId: config.projectId }),
      listCertifications(window.maestro.api, selectedGoalId, { projectId: config.projectId }),
    ])
      .then(([bundle, certificationList]) => {
        if (!active) return;
        setEvidenceBundle(bundle);
        setCertifications(certificationList.certifications);
      })
      .catch((cause: unknown) => {
        if (active) setEvidenceError(cause instanceof Error ? cause.message : "Could not load review evidence");
      });
    return () => {
      active = false;
    };
  }, [config?.projectId, selectedGoalId]);

  if (config === undefined) return <EmptyState />;

  const run = async (label: string, action: () => Promise<void>): Promise<void> => {
    if (busy !== undefined) return;
    setBusy(label);
    setRejectionReason(undefined);
    try {
      await action();
    } catch (cause) {
      setRejectionReason(cause instanceof Error ? cause.message : "The control plane rejected the request");
    } finally {
      setBusy(undefined);
    }
  };

  const branch = state?.branch ?? null;
  const latestRevision = state?.latestRevision ?? null;
  const selectedWorkerId = workerId.trim();
  const selectedWorkerCommit = integrationCommit?.workerId === selectedWorkerId ? integrationCommit : undefined;
  const selectedWorkerAcceptance = acceptance?.workerId === selectedWorkerId ? acceptance : undefined;
  const selectedWorkerCertifications = certifications.filter((certification) => certification.workerId === selectedWorkerId);
  const canCreateGoalBranch =
    selectedGoalId !== undefined &&
    goalBranch.repositoryPath.trim() !== "" &&
    goalBranch.branchName.trim() !== "" &&
    goalBranch.baseRevision.trim() !== "";
  const canCreateDepartmentBranch = selectedGoalId !== undefined && councilId.trim() !== "" && departmentId.trim() !== "";
  const canCreateWorktree = selectedWorkerId !== "" && worktreePath.trim() !== "";
  const references = splitEvidenceReferences(evidenceReferences);
  const canAdvance = selectedWorkerId !== "" && latestRevision !== null && integrationMessage.trim() !== "" && references.length > 0;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <div className="gitbar">
        <button type="button" className="gitbar-back" onClick={onBack}>
          <Icon name="arrow-left" /> back
        </button>
        <div className="gitbar-path">
          <Icon name="folder" /> {branch?.repositoryPath ?? "no integration branch yet"}
        </div>
        <div className="gitbar-branch">
          <Icon name="git-branch" /> {branch?.branchName ?? "—"}
        </div>
      </div>
      <div className="git-body" style={{ overflow: "auto" }}>
        {loading && (
          <p style={{ padding: 16 }} role="status">
            loading Git integration state…
          </p>
        )}
        {error !== undefined && (
          <div className="alert alert-warning" role="alert" style={{ margin: 16 }}>
            {error}
          </div>
        )}
        {rejectionReason !== undefined && (
          <div className="alert alert-warning" role="alert" style={{ margin: 16 }}>
            Integration rejected: {rejectionReason}
          </div>
        )}
        {evidenceError !== undefined && (
          <div className="alert alert-warning" role="alert" style={{ margin: 16 }}>
            Review evidence unavailable: {evidenceError}
          </div>
        )}

        <section className="office-panel" aria-labelledby="git-identity-heading">
          <h2 id="git-identity-heading">Goal Git identity</h2>
          {state === undefined && !loading && <p className="office-panel-empty">No server Git state has been loaded.</p>}
          {state !== undefined && branch === null && (
            <p className="office-panel-empty">No Goal integration branch yet. Create one through the control plane below.</p>
          )}
          {branch !== null && (
            <div className="office-subpanel">
              <p>repository path: {branch.repositoryPath}</p>
              <p>branch: {branch.branchName}</p>
              <p>base revision: {branch.baseRevision}</p>
              {latestRevision === null ? (
                <p>frozen revision: none</p>
              ) : (
                <>
                  <p>
                    frozen revision: {latestRevision.revisionNumber} · {latestRevision.revisionId}
                  </p>
                  <p>commit SHA: {latestRevision.commitSha}</p>
                  <p>frozen branch: {latestRevision.branchName}</p>
                </>
              )}
            </div>
          )}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy !== undefined || !canCreateGoalBranch}
            onClick={() =>
              void run("goal-branch", async () => {
                await createGoalIntegrationBranch(
                  window.maestro.api,
                  selectedGoalId!,
                  {
                    projectId: config.projectId,
                    repositoryPath: goalBranch.repositoryPath.trim(),
                    branchName: goalBranch.branchName.trim(),
                    baseRevision: goalBranch.baseRevision.trim(),
                  },
                  newCommandId(),
                );
                refresh();
              })
            }
          >
            {busy === "goal-branch" ? "Creating…" : "Create Goal integration branch"}
          </button>
          <div className="dash-field-group">
            <label className="dash-field">
              <span>Repository path</span>
              <input
                className="input"
                value={goalBranch.repositoryPath}
                onChange={(event) => setGoalBranch((current) => ({ ...current, repositoryPath: event.target.value }))}
                placeholder="Path returned or approved for this Goal"
              />
            </label>
            <label className="dash-field">
              <span>Branch name</span>
              <input
                className="input"
                value={goalBranch.branchName}
                onChange={(event) => setGoalBranch((current) => ({ ...current, branchName: event.target.value }))}
                placeholder="Goal integration branch"
              />
            </label>
            <label className="dash-field">
              <span>Base revision</span>
              <input
                className="input"
                value={goalBranch.baseRevision}
                onChange={(event) => setGoalBranch((current) => ({ ...current, baseRevision: event.target.value }))}
                placeholder="Immutable base revision"
              />
            </label>
          </div>
        </section>

        <section className="office-panel" aria-labelledby="git-department-heading">
          <h2 id="git-department-heading">Department branch</h2>
          {departmentBranch === undefined ? (
            <p className="office-panel-empty">No department branch was created in this session.</p>
          ) : (
            <div className="office-subpanel">
              <p>repository path: {departmentBranch.repositoryPath}</p>
              <p>branch: {departmentBranch.branchName}</p>
              <p>base branch: {departmentBranch.baseBranchName}</p>
            </div>
          )}
          <div className="dash-field-group">
            <label className="dash-field">
              <span>Council ID</span>
              <input
                className="input"
                value={councilId}
                onChange={(event) => setCouncilId(event.target.value)}
                placeholder="Loaded Council ID"
              />
            </label>
            <label className="dash-field">
              <span>Department ID</span>
              <input
                className="input"
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
                placeholder="Loaded department ID"
              />
            </label>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy !== undefined || !canCreateDepartmentBranch}
            onClick={() =>
              void run("department-branch", async () => {
                const result = await createDepartmentBranch(
                  window.maestro.api,
                  councilId.trim(),
                  departmentId.trim(),
                  { projectId: config.projectId },
                  newCommandId(),
                );
                setDepartmentBranch(result);
              })
            }
          >
            {busy === "department-branch" ? "Creating…" : "Create Department branch"}
          </button>
        </section>

        <section className="office-panel" aria-labelledby="git-revision-heading">
          <h2 id="git-revision-heading">Integration revision</h2>
          <p className="form-hint">The server's current Goal branch is required before a revision can be frozen.</p>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy !== undefined || selectedGoalId === undefined || branch === null}
            onClick={() =>
              void run("freeze-revision", async () => {
                await freezeGoalIntegrationRevisionFromBranch(
                  window.maestro.api,
                  selectedGoalId!,
                  branch !== null,
                  { projectId: config.projectId },
                  newCommandId(),
                );
                refresh();
              })
            }
          >
            {busy === "freeze-revision" ? "Freezing…" : "Freeze current integration revision"}
          </button>
        </section>

        <section className="office-panel" aria-labelledby="git-worker-heading">
          <h2 id="git-worker-heading">Worker worktree and integration</h2>
          <div className="dash-field-group">
            <label className="dash-field">
              <span>Worker ID</span>
              <input
                className="input"
                value={workerId}
                onChange={(event) => setWorkerId(event.target.value)}
                placeholder="Real Worker ID"
              />
            </label>
            <label className="dash-field">
              <span>Worktree path</span>
              <input
                className="input"
                value={worktreePath}
                onChange={(event) => setWorktreePath(event.target.value)}
                placeholder="Worker worktree path"
              />
            </label>
            <label className="dash-field">
              <span>Repository path (optional)</span>
              <input
                className="input"
                value={worktreeRepositoryPath}
                onChange={(event) => setWorktreeRepositoryPath(event.target.value)}
                placeholder="Use server-resolved path when blank"
              />
            </label>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy !== undefined || !canCreateWorktree}
            onClick={() =>
              void run("worker-worktree", async () => {
                const result = await createWorkerWorktree(
                  window.maestro.api,
                  selectedWorkerId,
                  {
                    projectId: config.projectId,
                    worktreePath: worktreePath.trim(),
                    ...(worktreeRepositoryPath.trim() === "" ? {} : { repositoryPath: worktreeRepositoryPath.trim() }),
                  },
                  newCommandId(),
                );
                setWorkerWorktree(result);
              })
            }
          >
            {busy === "worker-worktree" ? "Creating…" : "Create Worker worktree"}
          </button>
          {workerWorktree !== undefined && workerWorktree.workerId === selectedWorkerId && (
            <div className="office-subpanel">
              <p>worktree: {workerWorktree.worktreePath}</p>
              <p>branch: {workerWorktree.branchName}</p>
              <p>base branch: {workerWorktree.baseBranchName}</p>
            </div>
          )}

          <div className="dash-field-group">
            <label className="dash-field">
              <span>Integration message</span>
              <textarea
                className="input"
                value={integrationMessage}
                onChange={(event) => setIntegrationMessage(event.target.value)}
                placeholder="Describe the server integration"
              />
            </label>
            <label className="dash-field">
              <span>Evidence references (one per line)</span>
              <textarea
                className="input"
                value={evidenceReferences}
                onChange={(event) => setEvidenceReferences(event.target.value)}
                placeholder="Durable evidence IDs returned by the control plane"
              />
            </label>
          </div>
          {latestRevision === null && <p className="form-hint">No current server revision is available; integration cannot advance.</p>}
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy !== undefined || !canAdvance}
            onClick={() =>
              void run("worker-integration", async () => {
                const result = await advanceWorkerIntegrationFromRevision(
                  window.maestro.api,
                  selectedWorkerId,
                  config.projectId,
                  latestRevision,
                  { message: integrationMessage.trim(), evidenceReferences: references },
                  newCommandId(),
                );
                setIntegrationCommit(result);
              })
            }
          >
            {busy === "worker-integration" ? "Advancing…" : "Advance Worker integration"}
          </button>
          {selectedWorkerCommit !== undefined && (
            <div className="office-subpanel">
              <p>integrated commit: {selectedWorkerCommit.commitSha}</p>
              <p>message: {selectedWorkerCommit.message}</p>
              <p>evidence references: {selectedWorkerCommit.evidenceReferences.join(", ")}</p>
            </div>
          )}
        </section>

        {selectedWorkerId !== "" && (
          <WorkerReview
            key={`${selectedWorkerId}:${selectedWorkerCommit?.commitSha ?? "none"}`}
            api={window.maestro.api}
            projectId={config.projectId}
            workerId={selectedWorkerId}
            certifyingDepartmentId={departmentId.trim()}
            integrationCommit={selectedWorkerCommit}
            acceptance={selectedWorkerAcceptance}
            evidenceBundle={evidenceBundle}
            certifications={selectedWorkerCertifications}
            onAccepted={setAcceptance}
            onCertified={(certification) => setCertifications((current) => [...current, certification])}
          />
        )}
        {selectedGoalId !== undefined && evidenceBundle !== undefined && (
          <p className="form-hint">
            Review evidence is the server-issued Goal bundle {evidenceBundle.bundleId}; it is never edited in Carnegie.
          </p>
        )}
      </div>
    </div>
  );
}
