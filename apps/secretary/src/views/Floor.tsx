import { useConnection } from "../connection.js";
import { useGoals } from "../goals.js";
import { useGoalProjection } from "./panels/useGoalProjection.js";
import { RadialGraph } from "./panels/radial/RadialGraph.js";

export function Floor({ onBack, eventCursor = "0" }: { onBack: () => void; eventCursor?: string }) {
  const { config } = useConnection();
  const { goals, selectedGoalId, selectGoal } = useGoals();
  const goalId = selectedGoalId ?? goals?.[0]?.goalId;
  const projectionState = useGoalProjection(config === undefined ? undefined : window.maestro.api, config?.projectId, undefined, eventCursor);

  if (config === undefined) return <div className="floor-wrap"><div className="floor-empty" role="status">Connect to load the organization floor.</div></div>;
  if (goalId === undefined) return <div className="floor-wrap"><div className="floor-empty" role="status">Select a Goal to open its organization floor.</div></div>;
  if (projectionState.loading && projectionState.projection === undefined) return <div className="floor-wrap"><div className="floor-empty" role="status" aria-busy="true">Loading the durable organization projection…</div></div>;
  if (projectionState.error !== undefined && projectionState.projection === undefined) return <div className="floor-wrap"><div className="floor-empty alert alert-warning" role="alert">Could not load the organization projection: {projectionState.error}</div></div>;
  if (projectionState.projection === undefined) return <div className="floor-wrap"><div className="floor-empty" role="status">The organization projection is not available yet.</div></div>;

  return <RadialGraph projection={projectionState.projection} selectedGoalId={goalId} onSelectGoal={selectGoal} onBack={onBack} />;
}
