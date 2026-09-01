CREATE TABLE head_councils (
  council_id uuid PRIMARY KEY,
  goal_id uuid NOT NULL REFERENCES goals(goal_id),
  contract_id uuid NOT NULL REFERENCES task_contracts(contract_id),
  brief_deadline timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('collecting', 'revealed', 'resolved', 'escalated', 'stopped_no_new_evidence')),
  no_new_evidence_streak integer NOT NULL DEFAULT 0 CHECK (no_new_evidence_streak >= 0),
  decision_packet jsonb,
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  revealed_at timestamptz,
  closed_at timestamptz,
  CHECK ((state = 'collecting') = (revealed_at IS NULL)),
  CHECK ((state IN ('resolved', 'escalated')) = (decision_packet IS NOT NULL)),
  CHECK ((state NOT IN ('resolved', 'escalated')) OR closed_at IS NOT NULL),
  CHECK ((state <> 'stopped_no_new_evidence') OR closed_at IS NOT NULL)
);
CREATE INDEX head_councils_goal_state_idx ON head_councils (goal_id, state);

CREATE TABLE council_participants (
  council_id uuid NOT NULL REFERENCES head_councils(council_id),
  department_id text NOT NULL REFERENCES departments(department_id),
  absence_reason text,
  absent_at timestamptz,
  PRIMARY KEY (council_id, department_id),
  CHECK ((absence_reason IS NULL) = (absent_at IS NULL)),
  CHECK (absence_reason IS NULL OR btrim(absence_reason) <> '')
);

CREATE TABLE independent_briefs (
  council_id uuid NOT NULL,
  department_id text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  submitted_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (council_id, department_id),
  FOREIGN KEY (council_id, department_id) REFERENCES council_participants(council_id, department_id)
);

CREATE TABLE council_rounds (
  round_id uuid PRIMARY KEY,
  council_id uuid NOT NULL REFERENCES head_councils(council_id),
  round_number integer NOT NULL CHECK (round_number > 0),
  has_material_contribution boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (council_id, round_number)
);
CREATE INDEX council_rounds_council_number_idx ON council_rounds (council_id, round_number);

CREATE TABLE council_round_contributions (
  contribution_id uuid PRIMARY KEY,
  round_id uuid NOT NULL REFERENCES council_rounds(round_id),
  department_id text NOT NULL REFERENCES departments(department_id),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE(round_id, department_id)
);
CREATE INDEX council_round_contributions_round_idx ON council_round_contributions (round_id);

CREATE OR REPLACE FUNCTION council_participant_must_be_active() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c head_councils%ROWTYPE;
BEGIN
  SELECT * INTO c FROM head_councils WHERE council_id = NEW.council_id FOR KEY SHARE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM goal_head_participations p
    WHERE p.goal_id = c.goal_id AND p.department_id = NEW.department_id
      AND p.contract_id = c.contract_id AND p.status = 'active'
  ) THEN RAISE EXCEPTION 'Council participant must be an active Head bound to this Goal and contract'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER council_participant_active BEFORE INSERT ON council_participants FOR EACH ROW EXECUTE FUNCTION council_participant_must_be_active();

CREATE OR REPLACE FUNCTION reject_council_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'council history is append-only'; END; $$;
CREATE TRIGGER independent_briefs_append_only BEFORE UPDATE OR DELETE ON independent_briefs FOR EACH ROW EXECUTE FUNCTION reject_council_history_mutation();
CREATE TRIGGER council_rounds_append_only BEFORE UPDATE OR DELETE ON council_rounds FOR EACH ROW EXECUTE FUNCTION reject_council_history_mutation();
CREATE TRIGGER council_round_contributions_append_only BEFORE UPDATE OR DELETE ON council_round_contributions FOR EACH ROW EXECUTE FUNCTION reject_council_history_mutation();
