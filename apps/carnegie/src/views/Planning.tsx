import { useEffect, useState } from "react";
import type { HeadCouncil } from "@maestro/contracts";
import { useConnection } from "../connection.js";
import { useGoals } from "../goals.js";
import { EmptyState } from "../components/EmptyState.js";
import { ApiErrorNotice } from "../components/ApiErrorNotice.js";
import {
  activateDepartmentHead,
  currentPlanningStage,
  decideHeadCouncil,
  loadHeadCouncil,
  openHeadCouncil,
  revealHeadCouncil,
  selectOvertureRolesForContract,
  submitDepartmentBrief,
} from "../lib/planning-data.js";
import type { ViewName } from "../views.js";

function linesOf(value: string): readonly string[] {
  return value.split("\n").map((line) => line.trim()).filter((line) => line !== "");
}

export function Planning({ onNavigate }: { onNavigate: (view: ViewName) => void }) {
  const { config } = useConnection();
  const { goals, selectedGoalId } = useGoals();
  const goal = goals?.find((candidate) => candidate.goalId === selectedGoalId);

  const [departmentId, setDepartmentId] = useState("");
  const [overtureDone, setOvertureDone] = useState(false);
  const [headActive, setHeadActive] = useState(false);
  const [council, setCouncil] = useState<HeadCouncil | undefined>(undefined);
  const [briefText, setBriefText] = useState({ interpretation: "", contribution: "", risks: "", dependencies: "" });
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);

  useEffect(() => { setCouncil(undefined); setOvertureDone(false); setHeadActive(false); setError(undefined); }, [selectedGoalId]);

  if (config === undefined) return <EmptyState />;
  if (goal === undefined) return <EmptyState title="No Goal selected" hint="Select a Goal from the Dashboard before planning it." />;
  if (goal.contractId === undefined) return <EmptyState title="No Task Contract launched" hint="This Goal has no launched Task Contract yet; planning starts once one launches." />;

  const contractId = goal.contractId;
  const stage = currentPlanningStage({
    overtureSelected: overtureDone,
    headActive,
    council,
    departmentPlanExists: false,
    missionBundleExists: false,
  });

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setError(undefined);
    try {
      await action();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(undefined);
    }
  };

  const refreshCouncil = async (id: string) => {
    const loaded = await loadHeadCouncil(window.maestro.api, id, config.projectId);
    setCouncil(loaded);
  };

  return (
    <main className="dash-main">
      <header className="dash-head">
        <div>
          <div className="dash-kicker">Planning · {goal.goalId}</div>
          <h1 className="dash-title">Overture → Head → Council</h1>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => onNavigate("dashboard")}>Back to Dashboard</button>
      </header>

      {error !== undefined && <ApiErrorNotice error={error} />}

      <section className="office-panel" aria-labelledby="planning-overture">
        <h2 id="planning-overture">1. Overture</h2>
        {overtureDone ? (
          <p className="dash-empty">Overture role selection recorded by the server.</p>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy !== undefined}
            onClick={() => void run("overture", async () => {
              await selectOvertureRolesForContract(window.maestro.api, contractId, { projectId: config.projectId, outsideEvidenceRequested: false, previewNeeded: false });
              setOvertureDone(true);
            })}
          >
            {busy === "overture" ? "Selecting…" : "Select Overture roles"}
          </button>
        )}
      </section>

      {stage !== "overture" && (
        <section className="office-panel" aria-labelledby="planning-head">
          <h2 id="planning-head">2. Head activation</h2>
          <label className="dash-field">
            <span>Department ID</span>
            <input value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} placeholder="e.g. engineering" />
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy !== undefined || departmentId.trim() === ""}
            onClick={() => void run("head", async () => {
              await activateDepartmentHead(window.maestro.api, goal.goalId, {
                projectId: config.projectId,
                departmentId: departmentId.trim(),
                requestedContribution: "Planning this Goal from Carnegie",
                urgency: "normal",
                contextScope: [goal.goalId],
                budgetEffect: "none declared yet",
                reason: "Operator-initiated planning from Carnegie",
              });
              setHeadActive(true);
            })}
          >
            {busy === "head" ? "Activating…" : "Activate Head"}
          </button>
        </section>
      )}

      {stage !== "overture" && stage !== "head" && (
        <section className="office-panel" aria-labelledby="planning-council">
          <h2 id="planning-council">3. Council</h2>
          {council === undefined ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy !== undefined}
              onClick={() => void run("council", async () => {
                const created = await openHeadCouncil(window.maestro.api, goal.goalId, {
                  projectId: config.projectId,
                  contractId,
                  briefDeadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                  evidence: {},
                });
                setCouncil(created);
              })}
            >
              {busy === "council" ? "Creating…" : "Create Council"}
            </button>
          ) : (
            <div className="office-subpanel">
              <div className="office-panel-row"><span>{council.councilId}</span><span>{council.state}</span></div>

              {council.state === "collecting" && (
                <div className="dash-field-group">
                  <label className="dash-field"><span>Interpretation</span><textarea value={briefText.interpretation} onChange={(event) => setBriefText((current) => ({ ...current, interpretation: event.target.value }))} /></label>
                  <label className="dash-field"><span>Contribution</span><textarea value={briefText.contribution} onChange={(event) => setBriefText((current) => ({ ...current, contribution: event.target.value }))} /></label>
                  <label className="dash-field"><span>Risks (one per line)</span><textarea value={briefText.risks} onChange={(event) => setBriefText((current) => ({ ...current, risks: event.target.value }))} /></label>
                  <label className="dash-field"><span>Dependencies (one per line)</span><textarea value={briefText.dependencies} onChange={(event) => setBriefText((current) => ({ ...current, dependencies: event.target.value }))} /></label>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy !== undefined || departmentId.trim() === "" || briefText.interpretation.trim() === "" || briefText.contribution.trim() === ""}
                    onClick={() => void run("brief", async () => {
                      await submitDepartmentBrief(window.maestro.api, council.councilId, departmentId.trim(), {
                        projectId: config.projectId,
                        brief: {
                          interpretation: briefText.interpretation.trim(),
                          contribution: briefText.contribution.trim(),
                          nonGoals: ["Not specified"],
                          assumptions: ["Not specified"],
                          evidenceGaps: ["Not specified"],
                          risks: linesOf(briefText.risks).length > 0 ? linesOf(briefText.risks) : ["None identified"],
                          dependencies: linesOf(briefText.dependencies).length > 0 ? linesOf(briefText.dependencies) : ["None"],
                          proposedValidation: ["Not specified"],
                          expectedWorkers: ["Not specified"],
                          expectedCost: "Not specified",
                          expectedTime: "Not specified",
                          objectionsToLikelyAlternatives: ["None"],
                        },
                      });
                      await refreshCouncil(council.councilId);
                    })}
                  >
                    {busy === "brief" ? "Submitting…" : "Submit brief"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy !== undefined}
                    onClick={() => void run("reveal", async () => {
                      await revealHeadCouncil(window.maestro.api, council.councilId, config.projectId);
                      await refreshCouncil(council.councilId);
                    })}
                  >
                    {busy === "reveal" ? "Revealing…" : "Reveal briefs"}
                  </button>
                </div>
              )}

              {council.state === "revealed" && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy !== undefined}
                  onClick={() => void run("decide", async () => {
                    const decided = await decideHeadCouncil(window.maestro.api, council.councilId, {
                      projectId: config.projectId,
                      packet: {
                        outcome: "decided",
                        executionDisposition: "executable",
                        selectedDirection: "Proceed with the reviewed briefs",
                        rejectedAlternatives: [],
                        departmentOwnership: departmentId.trim() === "" ? [] : [{ departmentId: departmentId.trim(), responsibility: "Own the reviewed scope" }],
                        workerPlan: [],
                        completionCriteria: ["Reviewed briefs satisfied"],
                        failureCriteria: ["Reviewed briefs contradicted by evidence"],
                        dissent: [],
                        uncertainty: [],
                        criticalActions: [],
                        unresolvedConflicts: [],
                        evidenceReferences: [],
                      },
                    });
                    setCouncil(decided);
                  })}
                >
                  {busy === "decide" ? "Deciding…" : "Decide"}
                </button>
              )}

              {council.state === "resolved" && (
                <p className="dash-empty">
                  Council resolved. Department Plan and Mission Bundle creation need a per-item authoring surface this
                  screen does not build yet — read them once created via the Dashboard's Goal office detail, or create
                  them through the CLI for now.
                </p>
              )}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
