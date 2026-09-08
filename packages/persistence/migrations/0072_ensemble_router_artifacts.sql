-- Ensemble Router Phase 1 durable artifact boundaries.
-- Baselines remain repository-owned; these tables store only local observations,
-- per-Goal snapshots, and append-only routing decisions.
CREATE TABLE ensemble_router_operational_overlays (
  installation_ref text NOT NULL,
  project_ref text NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  overlay jsonb NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (installation_ref, project_ref, version)
);

CREATE INDEX ensemble_router_operational_overlays_latest_idx
  ON ensemble_router_operational_overlays (installation_ref, project_ref, version DESC);

CREATE TABLE ensemble_router_goal_overlay_snapshots (
  goal_ref text PRIMARY KEY,
  installation_ref text NOT NULL,
  project_ref text NOT NULL,
  overlay_version bigint NOT NULL CHECK (overlay_version > 0),
  snapshot jsonb NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE ensemble_router_routing_evidence (
  evidence_id text PRIMARY KEY,
  goal_ref text NOT NULL,
  project_ref text NOT NULL,
  route_ref text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('ensemble', 'pin')),
  selected_model_ref text NOT NULL,
  account_binding text NOT NULL,
  candidate_refs jsonb NOT NULL,
  task_demand_hash text NOT NULL CHECK (task_demand_hash ~ '^[a-f0-9]{64}$'),
  pressure double precision NOT NULL CHECK (pressure >= 0 AND pressure <= 200),
  pressure_band text NOT NULL CHECK (pressure_band IN ('low', 'medium', 'high', 'critical')),
  decision_layer text NOT NULL CHECK (decision_layer IN ('automatic progress', 'Department Head', 'Encore Council', 'user')),
  overlay_version bigint CHECK (overlay_version IS NULL OR overlay_version > 0),
  admission_binding_ref text NOT NULL,
  rationale text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  evidence jsonb NOT NULL
);

CREATE INDEX ensemble_router_routing_evidence_goal_idx
  ON ensemble_router_routing_evidence (goal_ref, created_at, evidence_id);

CREATE OR REPLACE FUNCTION maestro_block_routing_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ensemble router routing evidence is append-only';
END;
$$;

CREATE TRIGGER ensemble_router_routing_evidence_append_only
BEFORE UPDATE OR DELETE ON ensemble_router_routing_evidence
FOR EACH ROW EXECUTE FUNCTION maestro_block_routing_evidence_mutation();
