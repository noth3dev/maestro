-- Goal overlay snapshots are immutable evidence of the C state captured at admission.
CREATE OR REPLACE FUNCTION maestro_block_ensemble_router_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ensemble router Goal overlay snapshots are immutable';
END;
$$;

CREATE TRIGGER ensemble_router_goal_overlay_snapshots_append_only
BEFORE UPDATE OR DELETE ON ensemble_router_goal_overlay_snapshots
FOR EACH ROW EXECUTE FUNCTION maestro_block_ensemble_router_snapshot_mutation();
