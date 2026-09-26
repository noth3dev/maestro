-- Messages can reply to another message in the same conversation or channel,
-- so crew members and Heads answer each other in threads.
ALTER TABLE overture_messages ADD COLUMN IF NOT EXISTS reply_to_message_id uuid NULL;
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS reply_to_message_id uuid NULL;
