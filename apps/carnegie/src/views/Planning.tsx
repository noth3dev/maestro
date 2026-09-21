import { useEffect, useState } from "react";
import type { DepartmentPlan, HeadCouncil, HeadParticipation, MissionBundle } from "@maestro/contracts";
import { useConnection } from "../connection.js";
import { useGoals } from "../goals.js";
import { EmptyState } from "../components/EmptyState.js";
import { ApiErrorNotice } from "../components/ApiErrorNotice.js";
import {
  activateDepartmentHead,
  currentPlanningStage,
  decideHeadCouncil,
  departmentIdFromHead,
  departmentPlanDetails,
  isMissionBundleSelectionValid,
  loadDepartmentPlan,
  loadHeadCouncil,
  loadMissionBundle,
  missionBundleDetails,
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

  const [requestedDepartmentId, setRequestedDepartmentId] = useState("");
  const [overtureDone, setOvertureDone] = useState(false);
  const [headParticipation, setHeadParticipation] = useState<HeadParticipation | undefined>(undefined);
  const [council, setCouncil] = useState<HeadCouncil | undefined>(undefined);
  const [departmentPlan, setDepartmentPlan] = useState<DepartmentPlan | undefined>(undefined);
  const [missionBundle, setMissionBundle] = useState<MissionBundle | undefined>(undefined);
  const [itemId, setItemId] = useState("");
  const [briefText, setBriefText] = useState({ interpretation: "", contribution: "", risks: "", dependencies: "" });
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);

  useEffect(() => {
    setCouncil(undefined);
    setDepartmentPlan(undefined);
    setMissionBundle(undefined);
    setItemId("");
    setOvertureDone(false);
    setHeadParticipation(undefined);
    setError(undefined);
  }, [selectedGoalId]);

  if (config === undefined) return <EmptyState />;
  if (goal === undefined) return <EmptyState title="No Goal selected" hint="Select a Goal from the Dashboard before planning it." />;
  if (goal.contractId === undefined) return <EmptyState title="No Task Contract launched" hint="This Goal has no launched Task Contract yet; planning starts once one launches." />;

  const contractId = goal.contractId;
  const activatedDepartmentId = departmentIdFromHead(headParticipation);
  const headActive = headParticipation?.status === "active";
  const stage = currentPlanningStage({
    overtureSelected: overtureDone,
    headActive,
    council,
    departmentPlanExists: departmentPlan !== undefined,
    missionBundleExists: missionBundle !== undefined,
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
            <input value={activatedDepartmentId ?? requestedDepartmentId} onChange={(event) => setRequestedDepartmentId(event.target.value)} placeholder="e.g. engineering" disabled={headParticipation !== undefined} />
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy !== undefined || requestedDepartmentId.trim() === "" || headParticipation !== undefined}
            onClick={() => void run("head", async () => {
              const activated = await activateDepartmentHead(window.maestro.api, goal.goalId, {
                projectId: config.projectId,
                departmentId: requestedDepartmentId.trim(),
                requestedContribution: "Planning this Goal from Carnegie",
                urgency: "normal",
                contextScope: [goal.goalId],
                budgetEffect: "none declared yet",
                reason: "Operator-initiated planning from Carnegie",
              });
              setHeadParticipation(activated);
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
                    disabled={busy !== undefined || activatedDepartmentId === undefined || briefText.interpretation.trim() === "" || briefText.contribution.trim() === ""}
                    onClick={() => void run("brief", async () => {
                      await submitDepartmentBrief(window.maestro.api, council.councilId, activatedDepartmentId!, {
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
                        departmentOwnership: activatedDepartmentId === undefined ? [] : [{ departmentId: activatedDepartmentId, responsibility: "Own the reviewed scope" }],
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
                <>
                  <section className="office-panel" aria-labelledby="planning-plan">
                    <h2 id="planning-plan">4. Department Plan</h2>
                    <p className="dash-empty">Load the durable plan for the Head department. No local plan is treated as accepted.</p>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy !== undefined || activatedDepartmentId === undefined}
                      onClick={() => void run("department-plan", async () => {
                        setDepartmentPlan(undefined);
                        setMissionBundle(undefined);
                        setItemId("");
                        const loaded = await loadDepartmentPlan(window.maestro.api, council.councilId, activatedDepartmentId!, config.projectId);
                        setDepartmentPlan(loaded);
                      })}
                    >
                      {busy === "department-plan" ? "Loading…" : "Load Department Plan"}
                    </button>
                    {departmentPlan !== undefined && (() => {
                      const details = departmentPlanDetails(departmentPlan);
                      return (
                        <div className="office-subpanel">
                          <div className="office-panel-row"><span>version {details.scope.version}</span><span>{details.scope.contentHash}</span></div>
                          <p>{departmentPlan.substance.contribution}</p>
                          <p className="dash-empty">Scope: {details.scope.projectId} · Goal {details.scope.goalId} · Council {details.scope.councilId} · Department {details.scope.departmentId} · Head {details.scope.headRoleId}</p>
                          <p className="dash-empty">Constraints: {details.constraints.join(" · ")}</p>
                          <p className="dash-empty">Validation: {details.validation.join(" · ")}</p>
                          <ul>
                            {details.items.map((item) => (
                              <li key={item.itemId}>
                                <button type="button" className="btn btn-ghost" onClick={() => { setItemId(item.itemId); setMissionBundle(undefined); }}>{item.itemId}</button>
                                <span>{item.kind}: {item.objective} · depends on: {item.dependsOn.join(", ") || "none"} · worker: {item.workerAssignment || "none"} · evidence: {item.evidenceReferences.join(", ") || "none"}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })()}
                  </section>
                  <section className="office-panel" aria-labelledby="planning-bundle">
                    <h2 id="planning-bundle">5. Mission Bundle</h2>
                    <p className="dash-empty">Load a bundle only after the server has confirmed the exact plan version and item.</p>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy !== undefined || departmentPlan === undefined || activatedDepartmentId === undefined || !isMissionBundleSelectionValid(departmentPlan, itemId)}
                      onClick={() => void run("mission-bundle", async () => {
                        setMissionBundle(undefined);
                        const loaded = await loadMissionBundle(window.maestro.api, council.councilId, activatedDepartmentId!, departmentPlan!.version, itemId, config.projectId);
                        if (loaded.departmentId !== activatedDepartmentId || loaded.planVersion !== departmentPlan!.version || loaded.itemId !== itemId || loaded.planContentHash !== departmentPlan!.contentHash) {
                          throw new Error("Mission Bundle identity does not match the loaded Department Plan");
                        }
                        setMissionBundle(loaded);
                      })}
                    >
                      {busy === "mission-bundle" ? "Loading…" : "Load Mission Bundle"}
                    </button>
                    {missionBundle !== undefined && (() => {
                      const details = missionBundleDetails(missionBundle);
                      return (
                        <div className="office-subpanel">
                          <div className="office-panel-row"><span>{details.scope.itemId} · plan {details.scope.planVersion}</span><span>{details.scope.contentHash}</span></div>
                          <p>Scope: Council {details.scope.councilId} · Department {details.scope.departmentId} · Parent {details.scope.parentRef} · Plan hash {details.scope.planContentHash}</p>
                          <p>{details.validation.deliverable}</p>
                          <p className="dash-empty">Worker inputs: {details.workerInputs.goalBrief} · role {details.workerInputs.role} · profile {details.workerInputs.profileRef} · models {details.workerInputs.approvedModels.join(", ")} · skills {details.workerInputs.allowedSkills.join(", ")} · tools {details.workerInputs.allowedTools.join(", ")} · paths {details.workerInputs.allowedPaths.join(", ")} · environment {details.workerInputs.environment.join(", ")}</p>
                          <p className="dash-empty">Authority: {details.workerInputs.authorityBoundary.join(" · ")} · external: {details.workerInputs.externalServiceBoundary.join(" · ")} · data: {details.workerInputs.dataBoundary.join(" · ")}</p>
                          <p className="dash-empty">Evidence: {details.validation.evidenceRequirements.join(" · ")} · validation: {details.validation.validationCriteria.join(" · ")} · termination: {details.validation.terminationConditions.join(" · ")}</p>
                          <p className="dash-empty">Ceilings: cost {details.workerInputs.costCeiling} · time {details.workerInputs.timeCeiling} · retries {details.workerInputs.retryCeiling} · workers {details.workerInputs.workerCeiling}</p>
                          <p className="dash-empty">Worker execution is the next task. This screen does not invent a Worker action.</p>
                        </div>
                      );
                    })()}
                  </section>
                </>
              )}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
