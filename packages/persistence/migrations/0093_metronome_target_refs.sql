ALTER TABLE metronome_challenges ADD COLUMN IF NOT EXISTS target_ref text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'metronome_challenges_target_ref_nonblank') THEN
    ALTER TABLE metronome_challenges ADD CONSTRAINT metronome_challenges_target_ref_nonblank CHECK (target_ref IS NULL OR btrim(target_ref) <> '');
  END IF;
END $$;
