import React from "react";
import type { PersonaAxis, PersonaCoreIdentity, PersonaProfile } from "@maestro/domain";

const PERSONA_AXES: readonly PersonaAxis[] = ["agreeableness", "extraversion", "imagination", "realism", "conscientiousness", "caution", "initiative", "empathy", "adaptability", "sociability"];

export interface PersonaCandidateSummary {
  readonly candidateId: string; readonly version: number; readonly state: string; readonly changedAxes: readonly string[]; readonly decision: string; readonly invalidated: boolean;
}
export interface PersonaRolloutSummary {
  readonly rolloutId: string; readonly status: string; readonly activeCandidateId: string; readonly activeVersion: number;
  readonly rollbackTarget: { readonly candidateId: string; readonly version: number; readonly contentHash: string };
  readonly evidence: readonly { readonly kind: string; readonly evidenceId: string }[];
}
export interface PersonaInspectionModel {
  readonly roleId: string; readonly taskClass: string; readonly profile: PersonaProfile; readonly version: number; readonly coreIdentity: PersonaCoreIdentity;
  readonly taskClassAdjustment: { readonly roleId: string; readonly taskClass: string; readonly version: number; readonly delta: Readonly<Partial<Record<PersonaAxis, number>>>; readonly reason: string };
  readonly missionOverlay: Readonly<Partial<Record<PersonaAxis, number>>>; readonly proposalTemplate?: Record<string, unknown>; readonly candidates: readonly PersonaCandidateSummary[]; readonly rollouts: readonly PersonaRolloutSummary[];
}

const DISTINCTIVE_AXES: readonly PersonaAxis[] = ["caution", "initiative", "conscientiousness"];
const axisLabel = (axis: string) => axis.replaceAll("_", " ");

export function PersonaPanel({ model, expanded = false, error, onPropose }: { model: PersonaInspectionModel; expanded?: boolean; error?: string; onPropose?: (axis: PersonaAxis, value: number) => void }) {
  const axes = expanded ? PERSONA_AXES : DISTINCTIVE_AXES;
  return (
    <section className="persona-panel" aria-labelledby="persona-title">
      <header className="persona-panel-head">
        <div><div className="dash-title" id="persona-title">persona</div><div className="dash-sub">{model.roleId} · {model.taskClass}</div></div>
        {expanded && <span className="badge">learned version {model.version}</span>}
      </header>
      {error !== undefined && <div className="alert alert-warning" role="alert"><strong>server rejected proposal</strong>: {error}</div>}

      <article className="persona-identity" data-core-identity>
        <h3>core identity</h3>
        <p>{model.coreIdentity.mission}</p>
        <p>{model.coreIdentity.truthfulness} · {model.coreIdentity.safety}</p>
        <ul>{model.coreIdentity.authority.map((item) => <li key={item}>authority: {item}</li>)}</ul>
        <p>prohibited: {model.coreIdentity.prohibitedBehavior.join(", ")}</p>
      </article>

      <div className="persona-axes" aria-label={expanded ? "all persona axes" : "distinctive persona axes"}>
        {axes.map((axis) => (
          <label key={axis} className="persona-axis" data-axis={axis}>
            <span>{axisLabel(axis)} <output>{model.profile[axis].toFixed(2)}</output></span>
            {onPropose === undefined ? <div className="persona-axis-bar" aria-hidden="true"><span style={{ width: `${model.profile[axis] * 100}%` }} /></div> : (
              <input data-editable-axis={axis} aria-label={`propose ${axis}`} type="range" min="0" max="1" step="0.01" defaultValue={model.profile[axis]} onChange={(event) => onPropose(axis, Number(event.target.value))} />
            )}
          </label>
        ))}
      </div>

      {expanded && <div className="persona-layers">
        <h3>task-class adjustment</h3><p>version {model.taskClassAdjustment.version}: {model.taskClassAdjustment.reason}</p>
        <dl>{Object.entries(model.taskClassAdjustment.delta).map(([axis, delta]) => <div key={axis}><dt>{axisLabel(axis)}</dt><dd>{delta > 0 ? "+" : ""}{delta}</dd></div>)}</dl>
        <h3>active mission overlay</h3><p>{Object.keys(model.missionOverlay).length === 0 ? "none" : Object.entries(model.missionOverlay).map(([axis, delta]) => `${axisLabel(axis)} ${delta}`).join(", ")}</p>
      </div>}

      {expanded && model.candidates.length > 0 && <div className="persona-candidates"><h3>candidate proposals</h3>{model.candidates.map((candidate) => <div key={`${candidate.candidateId}:${candidate.version}`} data-candidate-id={candidate.candidateId}><strong>version {candidate.version}</strong> · {candidate.state} · {candidate.changedAxes.join(", ")} {candidate.invalidated && <span>— pending decision invalidated by version {candidate.version}</span>}</div>)}</div>}

      {expanded && model.rollouts.length > 0 && <div className="persona-rollbacks"><h3>rollout history</h3>{model.rollouts.map((rollout) => <article key={rollout.rolloutId} data-rollout-id={rollout.rolloutId}><strong>{rollout.status}</strong> · active {rollout.activeCandidateId} v{rollout.activeVersion}<p>rollback target: {rollout.rollbackTarget.candidateId} v{rollout.rollbackTarget.version} ({rollout.rollbackTarget.contentHash})</p><ul>{rollout.evidence.map((entry) => <li key={entry.evidenceId}>{entry.kind}: {entry.evidenceId}</li>)}</ul></article>)}</div>}
    </section>
  );
}
