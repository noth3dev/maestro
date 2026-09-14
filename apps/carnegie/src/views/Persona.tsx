import { useEffect, useState } from "react";
import type { PersonaInspection } from "@maestro/contracts";
import { useConnection } from "../connection.js";
import { useGoals } from "../goals.js";
import { PersonaPanel } from "./panels/persona/PersonaPanel.js";

export function Persona() {
  const { config } = useConnection();
  const { selectedGoalId } = useGoals();
  const [model, setModel] = useState<PersonaInspection>();
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (config === undefined || selectedGoalId === undefined) return;
    let active = true;
    void window.maestro.api.getPersona({ projectId: config.projectId, goalId: selectedGoalId, roleId: "concertmaster", taskClass: "implementation" }).then((next) => { if (active) { setModel(next); setError(undefined); } }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Persona inspection unavailable"); });
    return () => { active = false; };
  }, [config, selectedGoalId]);
  const propose = (axis: keyof PersonaInspection["profile"], value: number) => {
    if (config === undefined || selectedGoalId === undefined || model === undefined) return;
    const prior = model.candidates.at(-1);
    const source = prior?.candidate ?? model.proposalTemplate;
    if (source === undefined || typeof source !== "object" || Array.isArray(source)) { setError("No durable evidence-backed candidate proposal is available for this Goal."); return; }
    const changes = Array.isArray(source.changes) ? source.changes.map((change) => ({ ...(change as Record<string, unknown>) })) : [];
    const existing = changes.find((change) => change.axis === axis);
    if (existing !== undefined) existing.proposedValue = value;
    else if (changes.length < 2) changes.push({ axis, currentValue: model.profile[axis], proposedValue: value });
    else { setError("The learned candidate contract permits at most two axes per proposal."); return; }
    const candidate = { ...source, projectId: config.projectId, goalId: selectedGoalId, changes };
    const operation = prior === undefined
      ? window.maestro.api.proposePersona({ projectId: config.projectId, goalId: selectedGoalId, candidate }, globalThis.crypto.randomUUID())
      : window.maestro.api.editPersonaCandidate(prior.candidateId, { projectId: config.projectId, goalId: selectedGoalId, candidate }, globalThis.crypto.randomUUID());
    void operation.then(() => window.maestro.api.getPersona({ projectId: config.projectId, goalId: selectedGoalId, roleId: model.roleId, taskClass: model.taskClass })).then(setModel).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Persona proposal rejected by the control plane"));
  };
  if (config === undefined || selectedGoalId === undefined) return <div className="page-body"><p>Select a connected Goal to inspect its persona.</p></div>;
  return <div className="page-body"><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><h1>persona inspection</h1><button type="button" className="btn btn-sm" onClick={() => setExpanded((value) => !value)}>{expanded ? "collapse" : "expand"}</button></div>{error !== undefined && <div className="alert alert-warning" role="alert">{error}</div>}{model !== undefined && <PersonaPanel model={model} expanded={expanded} error={error} onPropose={propose} />}</div>;
}
