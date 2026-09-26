-- Concertmaster sessions can be removed from the list (kept for the Goals and
-- meetings that reference them).
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;
