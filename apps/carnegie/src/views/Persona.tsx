import { useEffect, useState } from "react";
import type { PersonaInspection } from "@maestro/contracts";
import type { ImprovementCandidate, ImprovementCandidateInput, PersonaAxis } from "@maestro/domain";
import { useConnection } from "../connection.js";
import { useGoals } from "../goals.js";
import { newCommandId } from "../lib/command-id.js";
import { editPersonaCandidate, getPersona, personaErrorMessage, proposePersona } from "../lib/persona-data.js";
import { PersonaPanel } from "./panels/persona/PersonaPanel.js";

export function buildPersonaCandidateInput(
  source: ImprovementCandidateInput | ImprovementCandidate,
  projectId: string,
  goalId: string,
  changes: readonly ImprovementCandidateInput["changes"][number][],
): ImprovementCandidateInput {
  return {
    schemaVersion: source.schemaVersion,
    projectId,
    goalId,
    kind: source.kind,
    target: source.target,
    changes,
    sourceEvidenceIds: source.sourceEvidenceIds,
    evidencePattern: source.evidencePattern,
    predictedEffect: source.predictedEffect,
    expectedMetrics: source.expectedMetrics,
    protectedMetrics: source.protectedMetrics,
    scenarioSuite: source.scenarioSuite,
    scenarioSuiteHash: source.scenarioSuiteHash,
    confidence: source.confidence,
    dataSufficiency: source.dataSufficiency,
    rollbackTarget: source.rollbackTarget,
  };
}

export function Persona() {
  const { config } = useConnection();
  const { selectedGoalId } = useGoals();
  const [model, setModel] = useState<PersonaInspection>();
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState<Partial<Record<PersonaAxis, number>>>({});
  const [mutationBusy, setMutationBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (config === undefined || selectedGoalId === undefined) return;
    let active = true;
    setLoading(true);
    setModel(undefined);
    setError(undefined);
    void getPersona(window.maestro.api, { projectId: config.projectId, goalId: selectedGoalId, roleId: "concertmaster", taskClass: "implementation" })
      .then((next) => { if (active) { setModel(next); setDraft({}); } })
      .catch((reason: unknown) => { if (active) setError(personaErrorMessage(reason, "Persona inspection unavailable")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [config, selectedGoalId]);

  const stageAxis = (axis: PersonaAxis, value: number) => {
    setDraft((current) => ({ ...current, [axis]: value }));
    setError(undefined);
  };

  const saveCandidate = async () => {
    if (config === undefined || selectedGoalId === undefined || model === undefined) return;
    const prior = model.candidates.at(-1);
    const source = prior?.candidate ?? model.proposalTemplate;
    if (source === undefined || typeof source !== "object" || Array.isArray(source)) {
      setError("No durable evidence-backed candidate proposal is available for this Goal.");
      return;
    }
    if (Object.keys(draft).length === 0) {
      setError("Adjust at least one persona axis before submitting a proposal.");
      return;
    }
    const changes = source.changes.map((change) => ({ ...change }));
    for (const [axis, value] of Object.entries(draft)) {
      const existing = changes.find((change) => change.axis === axis);
      if (existing !== undefined) existing.proposedValue = value;
      else if (changes.length < 2) changes.push({ axis: axis as PersonaAxis, currentValue: model.profile[axis as PersonaAxis] ?? 0, proposedValue: value });
      else {
        setError("The learned candidate contract permits at most two axes per proposal.");
        return;
      }
    }
    const candidate = buildPersonaCandidateInput(source, config.projectId, selectedGoalId, changes);
    setMutationBusy(true);
    setError(undefined);
    try {
      if (prior === undefined) await proposePersona(window.maestro.api, { projectId: config.projectId, goalId: selectedGoalId, candidate }, newCommandId());
      else if (prior.candidate !== undefined) await editPersonaCandidate(window.maestro.api, prior.candidateId, { projectId: config.projectId, goalId: selectedGoalId, candidate }, newCommandId());
      else throw new Error("The latest candidate payload is unavailable; reload before editing.");
      const refreshed = await getPersona(window.maestro.api, { projectId: config.projectId, goalId: selectedGoalId, roleId: model.roleId, taskClass: model.taskClass });
      setModel(refreshed);
      setDraft({});
    } catch (reason: unknown) {
      setError(personaErrorMessage(reason, "Persona proposal rejected by the control plane"));
    } finally {
      setMutationBusy(false);
    }
  };

  if (config === undefined || selectedGoalId === undefined) return <div className="page-body"><p>Select a connected Goal to inspect its persona.</p></div>;
  const latest = model?.candidates.at(-1);
  return <div className="page-body"><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><h1>persona inspection</h1><button type="button" className="btn btn-sm" onClick={() => setExpanded((value) => !value)}>{expanded ? "collapse" : "expand"}</button></div>{loading && model === undefined && <p role="status" aria-busy="true">loading persona…</p>}{error !== undefined && model === undefined && <div className="alert alert-warning" role="alert">{error}</div>}{model !== undefined && <PersonaPanel model={model} expanded={expanded} error={error} onPropose={stageAxis} onSubmitProposal={latest === undefined ? () => { void saveCandidate(); } : undefined} onSaveCandidateEdit={latest?.candidate !== undefined ? () => { void saveCandidate(); } : undefined} mutationBusy={mutationBusy} />}</div>;
}
