import React, { useState } from "react";
import { Icon } from "../icons.js";
import { EmptyState } from "../components/EmptyState.js";
import { useConnection } from "../connection.js";
import { useGoalArrangements } from "../useGoalArrangements.js";
import type { ArrangementCandidate, ArrangementCouncil, ArrangementNegativeEvidence } from "@maestro/api-client";

type ArrangementTab = "active" | "candidates" | "encoreCouncil" | "negativeEvidence";

function CandidateItem({ candidate }: { candidate: ArrangementCandidate }) {
  return (
    <div key={`${candidate.candidateId}:${candidate.version}`} className="arr-item">
      <div className="arr-icon" style={{ background: "var(--olive-bg)", color: "var(--olive-text)" }}><Icon name="lightbulb" /></div>
      <div className="arr-body">
        <div className="arr-title">{candidate.predictedEffect}</div>
        <div className="arr-meta">{candidate.kind} · {candidate.state} · v{candidate.version}</div>
        <div className="arr-meta">target: {candidate.target.roleId ?? candidate.target.routingTarget ?? "unscoped"}{candidate.target.taskClass === undefined ? "" : ` / ${candidate.target.taskClass}`}</div>
        <div className="arr-meta">content hash: {candidate.contentHash}</div>
        <div className="arr-meta">source evidence: {candidate.sourceEvidenceIds.length === 0 ? "none" : candidate.sourceEvidenceIds.join(", ")}</div>
        {candidate.evaluation !== null && <><div className="arr-meta">evaluation hash: {candidate.evaluation.evaluationHash}</div><div className="arr-meta">evaluation: replay {candidate.evaluation.stages.replay} · shadow {candidate.evaluation.stages.shadow} · synthetic {candidate.evaluation.stages.synthetic}</div></>}
        {candidate.evaluation?.metricDeltas.map((metric) => (
          <div key={metric.name} className="arr-meta">{metric.name}: {metric.baseline} → {metric.candidate} ({metric.delta >= 0 ? "+" : ""}{metric.delta})</div>
        ))}
        {candidate.rollout !== null && <div className="arr-meta">rollout: {candidate.rollout.status} · active v{candidate.rollout.activeVersion} · hash {candidate.rollout.contentHash}</div>}
      </div>
    </div>
  );
}

function CouncilItem({ entry }: { entry: ArrangementCouncil }) {
  return (
    <div className="arr-item">
      <div className="arr-icon" style={{ background: "var(--slate-bg)", color: "var(--slate-text)" }}><Icon name="message-square" /></div>
      <div className="arr-body">
        <div className="arr-title">{entry.finalVerdict} · round {entry.roundId}</div>
        <div className="arr-meta">{entry.question} · {entry.reviewerCount} reviewers</div>
        <div className="arr-meta">Council: {entry.sameModelOnly ? "same model only" : "independent models"} · {entry.escalated ? "escalated" : "not escalated"}</div>
        {entry.dissentNotes.length > 0 && <div className="arr-meta">dissent: {entry.dissentNotes.join(" · ")}</div>}
        {entry.judgments.map((judgment, index) => (
          <div key={`${judgment.modelProvider}/${judgment.modelId}:${index}`} className="arr-meta">{judgment.modelProvider}/{judgment.modelId} · {judgment.verdict} · {judgment.reasoning}</div>
        ))}
      </div>
    </div>
  );
}

function NegativeEvidenceItem({ entry }: { entry: ArrangementNegativeEvidence }) {
  return (
    <div className="arr-item">
      <div className="arr-icon" style={{ background: "var(--rust-bg)", color: "var(--rust-text)" }}><Icon name="ban" /></div>
      <div className="arr-body">
        <div className="arr-title">rejected candidate · {entry.candidateId}</div>
        <div className="arr-meta">reason: {entry.reason ?? "unavailable in durable rejection records"}{entry.roundId === null ? "" : ` · Council round ${entry.roundId}`}</div>
        {entry.judgments.map((judgment, index) => <div key={`${judgment.modelProvider}/${judgment.modelId}:${index}`} className="arr-meta">{judgment.modelProvider}/{judgment.modelId} · {judgment.reasoning}</div>)}
      </div>
    </div>
  );
}

export function Arrangements({ initialTab = "active" }: { initialTab?: ArrangementTab } = {}) {
  const { config } = useConnection();
  const { arrangements, loading, error } = useGoalArrangements();
  const [tab, setTab] = useState<ArrangementTab>(initialTab);

  if (config === undefined) return <EmptyState />;
  const items = arrangements === undefined ? [] : arrangements[tab];

  return (
    <div className="workspace-view">
      <header className="workspace-view-head">
        <div className="dash-kicker">act 3</div>
        <h1 className="dash-title">Arrangements</h1>
        <p className="dash-sub">Verified improvement state from durable candidates, Encore Council judgments, and bounded rollouts.</p>
        <span className="badge badge-slate">Act 3 read-only</span>
      </header>
      <div className="page-tabs">
        {(["active", "candidates", "encoreCouncil", "negativeEvidence"] as const).map((name) => (
          <button type="button" key={name} className={`page-tab${tab === name ? " on" : ""}`} onClick={() => setTab(name)}>{name === "encoreCouncil" ? "encore council" : name === "negativeEvidence" ? "negative evidence" : name}</button>
        ))}
      </div>
      <div className="page-body workspace-view-body">
        {loading && <p>loading…</p>}
        {error !== undefined && <div className="alert alert-warning">{error}</div>}
        {!loading && error === undefined && arrangements !== undefined && items.length === 0 && <p>No durable {tab === "encoreCouncil" ? "Encore Council judgments" : tab === "negativeEvidence" ? "negative evidence" : `${tab} arrangements`} for this Goal yet.</p>}
        {tab === "encoreCouncil" ? (items as ArrangementCouncil[]).map((entry) => <CouncilItem key={`${entry.candidateId}:${entry.roundId}`} entry={entry} />) : tab === "negativeEvidence" ? (items as ArrangementNegativeEvidence[]).map((entry) => <NegativeEvidenceItem key={entry.candidateId} entry={entry} />) : (items as ArrangementCandidate[]).map((candidate) => <CandidateItem key={`${candidate.candidateId}:${candidate.version}`} candidate={candidate} />)}
      </div>
      <p style={{ padding: "0 20px 14px", fontSize: 12, opacity: 0.7 }}>Act 3 state is read-only here; candidate mutation, Council decisions, and rollout controls remain authenticated backend actions.</p>
    </div>
  );
}
