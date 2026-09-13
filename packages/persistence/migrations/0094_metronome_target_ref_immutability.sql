-- Plan 6 §S9 remediation: worker challenge targets are immutable identity facts.
CREATE OR REPLACE FUNCTION reject_metronome_challenge_target_ref_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.target_ref IS DISTINCT FROM OLD.target_ref THEN
    RAISE EXCEPTION 'Metronome challenge target_ref is immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS metronome_challenges_target_ref_immutable ON metronome_challenges;
CREATE TRIGGER metronome_challenges_target_ref_immutable
  BEFORE UPDATE OF target_ref ON metronome_challenges
  FOR EACH ROW EXECUTE FUNCTION reject_metronome_challenge_target_ref_mutation();
