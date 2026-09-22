-- Extend durable provider account-login sessions to accept Anthropic Claude
-- (managed-subscription) logins alongside the existing OpenAI Codex identity.
-- Mirrors the "openai-codex" | "anthropic-claude" union widening already
-- applied across the contracts, agent-runtime, model-gateway, and
-- control-plane layers.

ALTER TABLE provider_account_login_sessions
  DROP CONSTRAINT IF EXISTS provider_account_login_sessions_provider_id_check;
ALTER TABLE provider_account_login_sessions
  ADD CONSTRAINT provider_account_login_sessions_provider_id_check
  CHECK (provider_id IN ('openai-codex', 'anthropic-claude'));

ALTER TABLE provider_account_login_sessions
  DROP CONSTRAINT IF EXISTS provider_account_login_sessions_auth_url_check;
ALTER TABLE provider_account_login_sessions
  ADD CONSTRAINT provider_account_login_sessions_auth_url_check
  CHECK (auth_url IS NULL OR auth_url ~ '^https://(chatgpt\.com|auth\.openai\.com|claude\.ai)(/|$)');
