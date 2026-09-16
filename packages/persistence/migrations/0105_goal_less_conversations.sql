-- Plan 9 §S1: project-scoped conversational intake may begin before a Goal exists.
-- Existing Goal-bound conversations retain the same project/Goal invariant.
ALTER TABLE conversations ALTER COLUMN goal_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION validate_conversation_goal_binding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.goal_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM goals WHERE goal_id = NEW.goal_id AND project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'Conversation Goal/project binding is invalid';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE conversation_schema text := current_schema();
BEGIN
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.validate_conversation_goal_binding() SET search_path = pg_catalog, %I', conversation_schema, conversation_schema);
END;
$$;
