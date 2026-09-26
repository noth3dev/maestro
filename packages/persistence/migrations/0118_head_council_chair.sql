-- The Overture conversation lead may speak in #head-council (it chairs the
-- Heads' planning meeting). Same function as 0100, with that one case added.
CREATE OR REPLACE FUNCTION assert_channel_message_author()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE channel_project uuid;
DECLARE channel_goal uuid;
DECLARE channel_scope_kind text;
DECLARE channel_scope_id text;
BEGIN
  SELECT project_id, goal_id, scope_kind, scope_id INTO channel_project, channel_goal, channel_scope_kind, channel_scope_id
    FROM channels WHERE channel_id = NEW.channel_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Channel message must reference an existing channel'; END IF;
  IF EXISTS (SELECT 1 FROM goals WHERE goal_id = channel_goal AND state IN ('stopped', 'succeeded', 'failed')) THEN
    RAISE EXCEPTION 'Channel is closed because its Goal has ended';
  END IF;
  IF NEW.author_kind = 'operator' AND NOT EXISTS (
    SELECT 1
      FROM local_operators o
      JOIN operator_project_memberships m ON m.operator_id = o.operator_id AND m.project_id = channel_project AND m.active = true
      JOIN operator_project_roles r ON r.operator_id = o.operator_id AND r.project_id = channel_project AND r.active = true
     WHERE o.operator_id::text = NEW.author_id
       AND o.active = true
       AND (
         (channel_scope_kind = 'department' AND r.role_id IN ('concertmaster', 'head-' || channel_scope_id))
         OR (channel_scope_kind = 'organization' AND channel_scope_id = 'general' AND r.role_id = 'concertmaster')
         OR (channel_scope_kind = 'organization' AND channel_scope_id = 'head-council' AND (r.role_id = 'concertmaster' OR EXISTS (SELECT 1 FROM departments d WHERE r.role_id = 'head-' || d.department_id)))
         OR (channel_scope_kind = 'encore' AND channel_scope_id = 'metronome' AND r.role_id IN ('concertmaster', 'encore-metronome'))
         OR (channel_scope_kind = 'encore' AND channel_scope_id = 'encore-council' AND r.role_id IN ('concertmaster', 'encore-council-1', 'encore-council-2', 'encore-council-3'))
       )
     FOR SHARE
  ) THEN RAISE EXCEPTION 'Channel message operator author must have active project membership and channel role'; END IF;
  IF NEW.author_kind = 'head' AND NOT EXISTS (
    SELECT 1 FROM goal_head_participations
    WHERE goal_id = channel_goal AND head_role_id = NEW.author_id AND status = 'active' AND active_session_ref IS NOT NULL
      AND ((channel_scope_kind = 'department' AND department_id = channel_scope_id) OR channel_scope_kind = 'organization')
  ) THEN RAISE EXCEPTION 'Channel message Head author must be active in the channel scope'; END IF;
  IF NEW.author_kind = 'worker' AND NOT EXISTS (
    SELECT 1 FROM workers w JOIN head_councils hc ON hc.council_id = w.council_id
    WHERE hc.goal_id = channel_goal AND w.worker_id::text = NEW.author_id AND w.status IN ('spawned', 'running', 'awaiting_repair', 'unknown')
      AND ((channel_scope_kind = 'department' AND w.department_id = channel_scope_id) OR (channel_scope_kind = 'organization' AND channel_scope_id = 'general'))
  ) THEN RAISE EXCEPTION 'Channel message Worker author must be active in the channel scope'; END IF;
  -- The Overture conversation lead (who wrote the PRD) chairs the Heads' planning meeting, and only there.
  IF NEW.author_kind = 'role' AND NEW.author_id = 'conversation-lead' THEN
    IF channel_scope_kind = 'organization' AND channel_scope_id = 'head-council' THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Channel message role author is outside the channel scope';
  END IF;
  IF NEW.author_kind = 'role' AND NOT EXISTS (
    SELECT 1 FROM permanent_roles
    WHERE role_id = NEW.author_id AND status = 'standing'
      AND ((channel_scope_kind = 'organization' AND channel_scope_id = 'general' AND role_id = 'concertmaster')
        OR (channel_scope_kind = 'organization' AND channel_scope_id = 'head-council' AND role_id = 'concertmaster')
        OR (channel_scope_kind = 'encore' AND channel_scope_id = 'encore-council' AND role_id IN ('encore-council-1', 'encore-council-2', 'encore-council-3'))
        OR (channel_scope_kind = 'encore' AND channel_scope_id = 'metronome' AND role_id = 'encore-metronome'))
  ) THEN RAISE EXCEPTION 'Channel message role author is outside the channel scope'; END IF;
  RETURN NEW;
END;
$$;
DO $$
DECLARE channel_schema text := current_schema();
BEGIN
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.assert_channel_message_author() SET search_path = pg_catalog, %I', channel_schema, channel_schema);
END;
$$;
