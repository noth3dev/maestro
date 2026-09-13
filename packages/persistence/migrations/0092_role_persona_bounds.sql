-- Reviewed role-duty floors and ceilings for temporary worker derivation.
-- Defaults are a bounded deviation from each immutable role baseline; callers
-- cannot supply or weaken these values at the derivation boundary.
CREATE TABLE IF NOT EXISTS role_persona_bounds (
  role_id text NOT NULL REFERENCES permanent_roles(role_id),
  axis text NOT NULL CHECK (axis IN (
    'agreeableness', 'extraversion', 'imagination', 'realism', 'conscientiousness',
    'caution', 'initiative', 'empathy', 'adaptability', 'sociability'
  )),
  floor_value numeric(3,2) NOT NULL CHECK (floor_value >= 0 AND floor_value <= 1),
  ceiling_value numeric(3,2) NOT NULL CHECK (ceiling_value >= 0 AND ceiling_value <= 1),
  rationale text NOT NULL CHECK (btrim(rationale) <> ''),
  PRIMARY KEY (role_id, axis),
  CHECK (floor_value <= ceiling_value)
);
CREATE INDEX IF NOT EXISTS role_persona_bounds_role_idx ON role_persona_bounds (role_id, axis);

-- Backfill an upgraded installation whose permanent taxonomy was bootstrapped
-- before this additive bounds table existed.
INSERT INTO role_persona_bounds (role_id, axis, floor_value, ceiling_value, rationale)
SELECT role_id, axis,
       GREATEST(0, ROUND(value - 0.15, 2)),
       LEAST(1, ROUND(value + 0.15, 2)),
       'role-persona-v1: reviewed duty bound from immutable baseline'
  FROM role_persona_axes
ON CONFLICT (role_id, axis) DO NOTHING;

CREATE OR REPLACE FUNCTION reject_role_persona_bounds_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'reviewed role persona bounds are immutable';
END;
$$;
DROP TRIGGER IF EXISTS role_persona_bounds_immutable ON role_persona_bounds;
CREATE TRIGGER role_persona_bounds_immutable
BEFORE UPDATE OR DELETE ON role_persona_bounds
FOR EACH ROW EXECUTE FUNCTION reject_role_persona_bounds_mutation();
