-- Phase 2 re-patch item 4: durable Mission persona overlay bound to mission
-- lifetime with explicit expiry (plan/phase2.md "Ten-axis persona
-- baseline" / Phase 2 Tests #11). One overlay per Mission Bundle,
-- identified the same way as mission_bundles itself. The overlay's own
-- explicit expires_at is the mission-lifetime bound (see
-- packages/persistence/src/mission-bundle.ts for the derivation and expiry
-- check). Additive only; no existing migration edited.

CREATE TABLE IF NOT EXISTS mission_persona_overlays (
  council_id uuid NOT NULL,
  department_id text NOT NULL,
  plan_version integer NOT NULL,
  item_id text NOT NULL,
  persona jsonb NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  expires_at timestamptz NOT NULL,
  retention retention_class NOT NULL DEFAULT 'project_lifetime',
  PRIMARY KEY (council_id, department_id, plan_version, item_id),
  FOREIGN KEY (council_id, department_id, plan_version, item_id)
    REFERENCES mission_bundles (council_id, department_id, plan_version, item_id),
  CHECK (expires_at > issued_at)
);

-- Keep the JSON representation equivalent to the typed ten-axis profile even
-- when a caller bypasses the persistence function with direct SQL.
CREATE OR REPLACE FUNCTION reject_invalid_mission_persona_overlay()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  axis text;
  axis_value text;
  axes CONSTANT text[] := ARRAY[
    'agreeableness', 'extraversion', 'imagination', 'realism',
    'conscientiousness', 'caution', 'initiative', 'empathy',
    'adaptability', 'sociability'
  ];
BEGIN
  IF jsonb_typeof(NEW.persona) IS DISTINCT FROM 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(NEW.persona)) <> cardinality(axes)
     OR EXISTS (
       SELECT 1
         FROM jsonb_object_keys(NEW.persona) AS entry(name)
        WHERE name <> ALL (axes)
     ) THEN
    RAISE EXCEPTION 'Mission persona overlay must contain exactly the ten known axes';
  END IF;
  FOREACH axis IN ARRAY axes LOOP
    IF jsonb_typeof(NEW.persona -> axis) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Mission persona overlay axis % must be numeric', axis;
    END IF;
    axis_value := NEW.persona ->> axis;
    BEGIN
      IF axis_value::numeric < 0 OR axis_value::numeric > 1 THEN
        RAISE EXCEPTION 'Mission persona overlay axis % must be in [0,1]', axis;
      END IF;
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'Mission persona overlay axis % must be a finite number in [0,1]', axis;
    END;
  END LOOP;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS mission_persona_overlays_axis_bounds ON mission_persona_overlays;
CREATE TRIGGER mission_persona_overlays_axis_bounds
  BEFORE INSERT ON mission_persona_overlays
  FOR EACH ROW EXECUTE FUNCTION reject_invalid_mission_persona_overlay();

CREATE OR REPLACE FUNCTION reject_mission_persona_overlay_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Mission persona overlays are append-only once issued';
END;
$$;
DROP TRIGGER IF EXISTS mission_persona_overlays_append_only ON mission_persona_overlays;
CREATE TRIGGER mission_persona_overlays_append_only
  BEFORE UPDATE OR DELETE ON mission_persona_overlays
  FOR EACH ROW EXECUTE FUNCTION reject_mission_persona_overlay_mutation();
