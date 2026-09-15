import React from "react";
import type { ConcertmasterFinalReport, EncoreCouncilRoundList, EvidenceBundleRead, GoalBudgetSummary, GoalEvent, MetronomeChallenge } from "@maestro/api-client";
import { RoutingEvidenceSchema, type Certification, type ProjectionNode, type ProjectionReadModel, type RoutingEvidence } from "@maestro/contracts";

export interface GoalDepartmentPanelsProps {
  projection: ProjectionReadModel;
  events: readonly GoalEvent[];
  budget?: GoalBudgetSummary | undefined;
  certifications: readonly Certification[];
  evidenceBundle?: EvidenceBundleRead | undefined;
  metronomeChallenges?: readonly MetronomeChallenge[] | undefined;
  encoreRounds?: EncoreCouncilRoundList["rounds"] | undefined;
  report?: ConcertmasterFinalReport | undefined;
  goalId?: string | undefined;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function nodeVersion(node: ProjectionNode): string | undefined {
  return node.version === null ? undefined : String(node.version);
}

function readRoutingEvidence(bundle: EvidenceBundleRead | undefined): readonly RoutingEvidence[] | undefined {
  if (bundle === undefined) return undefined;
  const raw = bundle.content.routingEvidence;
  if (!Array.isArray(raw)) return undefined;
  const parsed: RoutingEvidence[] = [];
  for (const entry of raw) {
    const candidate = typeof entry === "object" && entry !== null && "evidence" in entry ? (entry as { evidence?: unknown }).evidence : entry;
    const result = RoutingEvidenceSchema.safeParse(candidate);
    if (!result.success) return undefined;
    parsed.push(result.data);
  }
  return parsed;
}

function NodeIdentity({ node, children }: { node: ProjectionNode; children: React.ReactNode }) {
  return <div className="projection-record" data-node-id={node.nodeId} data-node-version={nodeVersion(node)}>{children}</div>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="office-panel" aria-labelledby={`panel-${title.toLowerCase().replaceAll(" ", "-")}`}><h2 id={`panel-${title.toLowerCase().replaceAll(" ", "-")}`}>{title}</h2>{children}</section>;
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return <p className="office-panel-empty">{children}</p>;
}

export function GoalDepartmentPanels({ projection, events, budget, certifications, evidenceBundle, metronomeChallenges, encoreRounds, report, goalId }: GoalDepartmentPanelsProps) {
  const scopedNodes = projection.nodes.filter((node) => !node.removed && (goalId === undefined || node.goalId === goalId));
  const goal = scopedNodes.find((node) => node.kind === "goal");
  const departments = scopedNodes.filter((node) => node.kind === "department_plan");
  const workers = scopedNodes.filter((node) => node.kind === "worker");
  const approvals = scopedNodes.filter((node) => node.kind === "capability_approval");
  const scopedEvents = events.filter((event) => goalId === undefined || event.goalId === goalId);
  const routingEvidence = readRoutingEvidence(evidenceBundle);

  return (
    <div className="office-panels" data-projection-cursor={projection.eventCursor}>
      <Panel title="Goal timeline">
        {goal !== undefined && <NodeIdentity node={goal}><div className="office-panel-row"><strong>{goal.state}</strong><span>durable v{goal.version ?? "—"}</span><span>cursor {goal.eventCursor}</span></div></NodeIdentity>}
        {scopedEvents.length === 0 ? <EmptyPanel>No durable Goal events yet.</EmptyPanel> : (
          <ol className="office-timeline">
            {scopedEvents.map((event) => <li key={event.eventId}><span className="office-record-id">{event.eventType}</span><span>cursor {event.cursor}</span><time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time></li>)}
          </ol>
        )}
      </Panel>

      <Panel title="Department room">
        {departments.length === 0 ? <EmptyPanel>No Departments participate in this Goal.</EmptyPanel> : (
          <div className="office-department-list">
            {departments.map((department) => {
              const sleeping = department.state === "sleeping";
              return <NodeIdentity key={department.nodeId} node={department}>
                <div className={`office-department${sleeping ? " sleeping" : ""}`}>
                  <div><strong>{department.sectorId ?? department.sourceKey.at(-1)}</strong><span className="office-state">{department.state}</span></div>
                  {!sleeping && <div className="office-muted">{department.ownerId ?? "unassigned"} · v{department.version ?? "—"}</div>}
                </div>
              </NodeIdentity>;
            })}
          </div>
        )}
      </Panel>

      <Panel title="Plans and workers">
        <div className="office-subpanel"><h3>Department Plans</h3>{departments.length === 0 ? <EmptyPanel>No Department Plans recorded.</EmptyPanel> : departments.map((plan) => <NodeIdentity key={plan.nodeId} node={plan}><div className="office-panel-row"><span>{plan.sectorId ?? plan.sourceKey.at(-1)}</span><span>{plan.state}</span>{plan.state !== "sleeping" && <span>v{plan.version ?? "—"}</span>}</div></NodeIdentity>)}</div>
        <div className="office-subpanel"><h3>Workers</h3>{workers.length === 0 ? <EmptyPanel>No workers recorded.</EmptyPanel> : workers.map((worker) => <NodeIdentity key={worker.nodeId} node={worker}><div className="office-panel-row"><span>{worker.sectorId ?? "worker"}</span><span>{worker.state}</span><span>{worker.ownerId ?? "unassigned"}</span></div></NodeIdentity>)}</div>
      </Panel>

      <Panel title="Budget">
        {budget === undefined ? <EmptyPanel>Budget is not available for this Goal.</EmptyPanel> : <div className="office-budget-grid"><span>{formatCents(budget.budgetCents)} ceiling</span><span>{formatCents(budget.reservedCents)} reserved</span><span>{formatCents(budget.costCents)} spent</span><span>{formatCents(Math.max(0, budget.budgetCents - budget.reservedCents))} remaining</span></div>}
      </Panel>

      <Panel title="Authority">
        {approvals.length === 0 ? <EmptyPanel>No capability approvals recorded.</EmptyPanel> : approvals.map((approval) => <NodeIdentity key={approval.nodeId} node={approval}><div className="office-panel-row"><span className="office-record-id">{approval.nodeId}</span><span>{approval.state.replaceAll("_", "-")}</span><span>{approval.sectorId ?? "capability"}</span></div></NodeIdentity>)}
      </Panel>

      <Panel title="Evidence">
        {evidenceBundle === undefined ? <EmptyPanel>No evidence bundle recorded for this Goal.</EmptyPanel> : <div className="office-record" data-record-kind="evidence-bundle" data-record-id={evidenceBundle.bundleId}><strong>{evidenceBundle.bundleId}</strong><span>hash {evidenceBundle.hash}</span></div>}
      </Panel>

      <Panel title="Routing">
        {routingEvidence === undefined ? <EmptyPanel>Routing state unavailable.</EmptyPanel> : routingEvidence.length === 0 ? <EmptyPanel>routing-off · no durable routed model evidence for this Goal.</EmptyPanel> : routingEvidence.map((route) => <div className="office-record" key={route.evidenceId} data-record-kind="routing-evidence" data-record-id={route.evidenceId}><strong>{route.mode} · {route.selectedModelRef}</strong><span>pressure {route.pressure} ({route.pressureBand}) · {route.decisionLayer}</span>{route.rejections.length > 0 && <span>rejected candidates: {route.rejections.map((rejection) => `${rejection.candidateRef}: ${rejection.reason}`).join("; ")}</span>}</div>)}
      </Panel>

      <Panel title="Certification">
        {certifications.length === 0 ? <EmptyPanel>No certifications recorded for this Goal.</EmptyPanel> : certifications.map((certification) => <div className="office-record" key={certification.certificationId} data-record-kind="certification" data-record-id={certification.certificationId}><strong>{certification.certificationId}</strong><span>{certification.kind} · {certification.verdict}</span><span>commit {certification.integratedCommitSha}</span></div>)}
      </Panel>

      <Panel title="Metronome">
        {metronomeChallenges === undefined ? <EmptyPanel>Metronome state unavailable.</EmptyPanel> : metronomeChallenges.length === 0 ? <EmptyPanel>No Metronome challenges recorded for this Goal.</EmptyPanel> : metronomeChallenges.map((challenge) => <div className="office-record" key={challenge.challengeId} data-record-kind="metronome-challenge" data-record-id={challenge.challengeId}><strong>{challenge.status}</strong><span>{challenge.reason}</span></div>)}
      </Panel>

      <Panel title="Encore">
        {encoreRounds === undefined ? <EmptyPanel>Encore Council state unavailable.</EmptyPanel> : encoreRounds.length === 0 ? <EmptyPanel>No Encore Council rounds recorded for this Goal.</EmptyPanel> : encoreRounds.map((round) => <div className="office-record" key={round.roundId} data-record-kind="encore-round" data-record-id={round.roundId}><strong>{round.synthesis.finalVerdict}</strong><span>{round.question}</span></div>)}
      </Panel>

      <Panel title="Discord incidents">
        {report === undefined ? <EmptyPanel>Discord incident state unavailable.</EmptyPanel> : report.incidents.length === 0 ? <EmptyPanel>No Discord incidents recorded for this Goal.</EmptyPanel> : report.incidents.map((incident) => <div className="office-record" key={incident} data-record-kind="discord-incident"><span>{incident}</span></div>)}
      </Panel>
    </div>
  );
}
