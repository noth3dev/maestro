import { useEffect, useState, type ReactNode } from "react";
import type { ApiClient } from "@maestro/api-client";
import type { GoalPlan } from "@maestro/contracts";
import { Icon } from "../icons.js";
import { useConnection } from "../connection.js";
import { useGoals } from "../goals.js";
import { buildKanbanBoard, departmentLabel, KANBAN_COLUMNS, kanbanColumnLabels, planSummary, type KanbanCard } from "../lib/kanban-data.js";

type PlanState = { loading: boolean; plan: GoalPlan | null | undefined; error: string | undefined };

function useGoalPlan(api: Pick<ApiClient, "getGoalPlan"> | undefined, projectId: string | undefined, goalId: string | undefined, refreshKey: string): PlanState {
  const [state, setState] = useState<PlanState>({ loading: false, plan: undefined, error: undefined });
  useEffect(() => {
    if (api === undefined || projectId === undefined || goalId === undefined) {
      setState({ loading: false, plan: undefined, error: undefined });
      return;
    }
    let cancelled = false;
    setState((previous) => ({ ...previous, loading: true }));
    api.getGoalPlan(goalId, { projectId }).then(
      (read) => { if (!cancelled) setState({ loading: false, plan: read.plan, error: undefined }); },
      (error: unknown) => { if (!cancelled) setState((previous) => ({ ...previous, loading: false, error: error instanceof Error ? error.message : String(error) })); },
    );
    return () => { cancelled = true; };
  }, [api, projectId, goalId, refreshKey]);
  return state;
}

function SliceCard({ card }: { card: KanbanCard }) {
  const [open, setOpen] = useState(false);
  const { slice } = card;
  return (
    <li className={`kb-card${card.blocked ? " kb-card-blocked" : ""}`} data-slice-id={slice.sliceId}>
      <button type="button" className="kb-card-head" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="kb-slice-id">{slice.sliceId}</span>
        <span className="kb-card-title">{slice.title}</span>
        {card.blocked && <span className="kb-blocked" title={slice.statusReason ?? undefined}><Icon name="octagon-alert" aria-hidden="true" />blocked</span>}
      </button>
      {card.waitingOn.length > 0 && !open && <div className="kb-card-meta">waits on {card.waitingOn.join(", ")}</div>}
      {open && (
        <div className="kb-card-body">
          <p>{slice.objective}</p>
          {card.blocked && slice.statusReason !== null && <p className="kb-blocked-reason">{slice.statusReason}</p>}
          <div className="kb-card-label">acceptance</div>
          <ul>{slice.acceptance.map((line) => <li key={line}>{line}</li>)}</ul>
          {slice.dependsOn.length > 0 && <div className="kb-card-meta">depends on {slice.dependsOn.join(", ")}</div>}
        </div>
      )}
    </li>
  );
}

/** Shown when the Encore Council escalated the plan (or rejected it after a revision): the operator decides. */
export function PlanDecision({ plan, onDecided }: { plan: GoalPlan; onDecided: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const decide = async (decision: "approve" | "revise") => {
    setBusy(true);
    setError(undefined);
    try {
      await window.maestro.api.decideGoalPlan(plan.goalId, { projectId: plan.projectId, version: plan.version, decision, ...(note.trim() === "" ? {} : { note: note.trim() }) });
      setNote("");
      onDecided();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="kb-decision" aria-label="Plan decision">
      <strong>Plan v{plan.version} needs your decision</strong>
      {plan.decisionNote !== null && plan.decisionNote !== undefined && <p className="kb-decision-note">{plan.decisionNote}</p>}
      <textarea aria-label="Note for the Heads" rows={2} placeholder="What should change? (needed to send it back)" value={note} onChange={(event) => setNote(event.target.value)} />
      <div className="kb-decision-actions">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void decide("approve")}>approve plan</button>
        <button type="button" className="btn btn-sm" disabled={busy || note.trim() === ""} onClick={() => void decide("revise")}>send back to the Heads</button>
        {error !== undefined && <span className="kb-decision-error" role="alert">{error}</span>}
      </div>
    </section>
  );
}

/** The Department Heads' plan for one Goal as a board: department swimlanes × slice status. */
export function KanbanBoardView({ plan }: { plan: GoalPlan }) {
  const board = buildKanbanBoard(plan);
  return (
    <div className="kb-board-scroll">
      {board.phases.length > 0 && (
        <ol className="kb-phases" aria-label="Phases">
          {board.phases.map((phase) => (
            <li key={phase.phaseNo}><span className="kb-phase-no">p{phase.phaseNo}</span> {phase.title}<span className="kb-phase-outcome"> — {phase.outcome}</span></li>
          ))}
        </ol>
      )}
      <div className="kb-board" role="table" aria-label="Slice board" style={{ gridTemplateColumns: `140px repeat(${KANBAN_COLUMNS.length}, minmax(160px, 1fr))` }}>
        <div role="row" className="kb-row kb-row-head">
          <div role="columnheader" className="kb-lane-head">department</div>
          {KANBAN_COLUMNS.map((column) => (
            <div role="columnheader" key={column} className="kb-col-head">{kanbanColumnLabels[column]}<span className="kb-count">{board.totals[column]}</span></div>
          ))}
        </div>
        {board.lanes.map((lane) => (
          <div role="row" className="kb-row" key={lane.departmentId}>
            <div role="rowheader" className="kb-lane-head">
              <span className="kb-lane-name">{departmentLabel(lane.departmentId)}</span>
              <span className="kb-lane-progress">{lane.done}/{lane.total}</span>
            </div>
            {KANBAN_COLUMNS.map((column) => (
              <div role="cell" key={column} className="kb-cell" aria-label={`${departmentLabel(lane.departmentId)} ${kanbanColumnLabels[column]}`}>
                <ul className="kb-cards">{lane.cells[column].map((card) => <SliceCard key={card.slice.sliceId} card={card} />)}</ul>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Kanban({ eventCursor = "0" }: { eventCursor?: string }) {
  const { config } = useConnection();
  const { goals, selectedGoalId, selectGoal } = useGoals();
  const goalId = selectedGoalId ?? goals?.[0]?.goalId;
  const [decisions, setDecisions] = useState(0);
  const { loading, plan, error } = useGoalPlan(config === undefined ? undefined : window.maestro.api, config?.projectId, goalId, `${eventCursor}:${decisions}`);

  let body: ReactNode;
  if (config === undefined) body = <div className="kb-empty" role="status">Connect to load the board.</div>;
  else if (goalId === undefined) body = <div className="kb-empty" role="status">No Goal yet. Launch a Task Contract from a Concertmaster session to start one.</div>;
  else if (plan === undefined && loading) body = <div className="kb-empty" role="status" aria-busy="true">Loading the plan…</div>;
  else if (plan === undefined && error !== undefined) body = <div className="kb-empty alert alert-warning" role="alert">Could not load the plan: {error}</div>;
  else if (plan === null || plan === undefined) body = <div className="kb-empty" role="status">The Department Heads have not planned this Goal yet. Slices appear here once they meet.</div>;
  else
    body = (
      <>
        {plan.status === "awaiting_approval" && <PlanDecision plan={plan} onDecided={() => setDecisions((count) => count + 1)} />}
        <KanbanBoardView plan={plan} />
      </>
    );

  return (
    <div className="kb-wrap">
      <div className="kb-head">
        <span className="kb-title">board</span>
        {goals !== undefined && goals.length > 1 && (
          <select className="kb-goal-select" aria-label="Goal" value={goalId} onChange={(event) => selectGoal(event.target.value)}>
            {goals.map((goal) => <option key={goal.goalId} value={goal.goalId}>{goal.goalId.slice(0, 8)} · {goal.state}</option>)}
          </select>
        )}
        {plan !== undefined && plan !== null && <span className="kb-summary">{planSummary(plan)}</span>}
        {error !== undefined && plan !== undefined && <span className="kb-summary kb-stale" role="status">refresh failed — showing the last plan</span>}
      </div>
      {body}
    </div>
  );
}
