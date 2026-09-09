-- Durable operator resolution for an IPython effect whose repetition claim was
-- committed before the process could prove whether the external effect ran.
CREATE TABLE IF NOT EXISTS capability_effect_resolutions (
  resolution_id uuid PRIMARY KEY,
  claim_id uuid NOT NULL REFERENCES capability_repetition_claims(claim_id),
  approval_id uuid NOT NULL REFERENCES capability_approvals(approval_id),
  capability_kind text NOT NULL CHECK (btrim(capability_kind) <> ''),
  project_id uuid NOT NULL,
  goal_id uuid NOT NULL REFERENCES goals(goal_id),
  command_id text NOT NULL CHECK (btrim(command_id) <> ''),
  effect_index integer NOT NULL CHECK (effect_index >= 0),
  outcome text NOT NULL CHECK (outcome IN ('confirmed', 'aborted')),
  resolved_by text NOT NULL CHECK (btrim(resolved_by) <> ''),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  resolved_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (capability_kind, goal_id, command_id, effect_index)
);
CREATE INDEX IF NOT EXISTS capability_effect_resolutions_goal_idx
  ON capability_effect_resolutions (capability_kind, project_id, goal_id, resolved_at);

CREATE OR REPLACE FUNCTION validate_capability_effect_resolution_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE claim_row capability_repetition_claims%ROWTYPE;
BEGIN
  SELECT * INTO claim_row FROM capability_repetition_claims WHERE claim_id = NEW.claim_id;
  IF NOT FOUND OR claim_row.approval_id <> NEW.approval_id
     OR claim_row.capability_kind <> NEW.capability_kind
     OR claim_row.project_id <> NEW.project_id OR claim_row.goal_id <> NEW.goal_id
     OR claim_row.command_id <> NEW.command_id OR claim_row.effect_index <> NEW.effect_index THEN
    RAISE EXCEPTION 'Capability effect resolution identity does not match repetition claim';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS capability_effect_resolutions_scope ON capability_effect_resolutions;
CREATE TRIGGER capability_effect_resolutions_scope BEFORE INSERT ON capability_effect_resolutions
  FOR EACH ROW EXECUTE FUNCTION validate_capability_effect_resolution_scope();

CREATE OR REPLACE FUNCTION reject_capability_effect_resolution_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.resolution_id IS DISTINCT FROM NEW.resolution_id
     OR OLD.claim_id IS DISTINCT FROM NEW.claim_id OR OLD.approval_id IS DISTINCT FROM NEW.approval_id
     OR OLD.capability_kind IS DISTINCT FROM NEW.capability_kind OR OLD.project_id IS DISTINCT FROM NEW.project_id
     OR OLD.goal_id IS DISTINCT FROM NEW.goal_id OR OLD.command_id IS DISTINCT FROM NEW.command_id
     OR OLD.effect_index IS DISTINCT FROM NEW.effect_index OR OLD.outcome IS DISTINCT FROM NEW.outcome
     OR OLD.resolved_by IS DISTINCT FROM NEW.resolved_by OR OLD.reason IS DISTINCT FROM NEW.reason
     OR OLD.resolved_at IS DISTINCT FROM NEW.resolved_at THEN
    RAISE EXCEPTION 'Capability effect resolutions are append-only';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS capability_effect_resolutions_append_only ON capability_effect_resolutions;
CREATE TRIGGER capability_effect_resolutions_append_only BEFORE UPDATE OR DELETE ON capability_effect_resolutions
  FOR EACH ROW EXECUTE FUNCTION reject_capability_effect_resolution_mutation();
