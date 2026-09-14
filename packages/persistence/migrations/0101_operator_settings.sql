CREATE TABLE IF NOT EXISTS operator_settings (
  operator_id uuid PRIMARY KEY REFERENCES local_operators(operator_id) ON DELETE CASCADE,
  preferences jsonb NOT NULL DEFAULT '{"compactSidebar":false,"desktopPush":true,"emailDigest":false,"slackWebhook":false}'::jsonb,
  model_pool jsonb NOT NULL DEFAULT '{"enabledModelRefs":[]}'::jsonb,
  spend_ceiling_cents bigint NOT NULL DEFAULT 5000 CHECK (spend_ceiling_cents >= 0),
  critical_actions_require_approval boolean NOT NULL DEFAULT true,
  allow_flashmob boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
