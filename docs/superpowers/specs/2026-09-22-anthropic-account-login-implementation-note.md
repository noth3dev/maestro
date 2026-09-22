# Anthropic (Claude Pro/Max) Account Login — Implementation Note

Ported reference (MIT, from local ~/prime-agent repo, package @mariozechner/pi-ai):
/tmp/prime-agent-oauth-reference/anthropic.ts (+ pkce.ts, types.ts, oauth-page.ts for structure reference only)

Real OAuth facts to reuse exactly:
- authorize URL: https://claude.ai/oauth/authorize
- token URL: https://platform.claude.com/v1/oauth/token
- client_id: base64-decode "OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl" -> "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
- redirect_uri: http://localhost:53692/callback (fixed local callback port 53692, path /callback)
- scope: "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload"
- PKCE S256, state == code_verifier (Anthropic's flow reuses the verifier as state)
- token exchange body: { grant_type: "authorization_code", client_id, code, state, redirect_uri, code_verifier }
- refresh body: { grant_type: "refresh_token", client_id, refresh_token }
- Messages API calls with an OAuth access token use `Authorization: Bearer <access_token>` plus header
  `anthropic-beta: oauth-2025-04-20` INSTEAD OF the `x-api-key` header used by API-key auth. Keep the
  request/response body shape identical to the existing packages/model-provider-anthropic/src/index.ts
  AnthropicProvider (system/messages/tools mapping, response parsing) — only the auth transport differs.

## Existing Maestro architecture to mirror (Codex OAuth is the working precedent)

- packages/model-provider-openai/src/codex-oauth.ts -> CodexOAuthClient (PKCE, local http callback server,
  in-memory pending-login map, startXLogin/getLoginStatus/cancelLogin/refresh shape). Mirror this exactly
  for Anthropic as packages/model-provider-anthropic/src/claude-oauth.ts exporting `ClaudeOAuthClient`.
- packages/model-provider-openai/src/codex-responses.ts -> createCodexResponsesPlugin(), a ProviderPlugin
  that authenticates via a resolved OAuth access token instead of a static API key. Mirror as
  packages/model-provider-anthropic/src/claude-subscription.ts exporting
  `createClaudeSubscriptionPlugin()`, providerId identity "anthropic-claude", authMode
  "managed-subscription", reusing the existing AnthropicProvider request/response mapping logic but
  swapping the auth header per above.
- packages/contracts/src/provider-credentials.ts: `ProviderAccountLoginStartInputSchema`,
  `ProviderAccountLoginStartResultSchema`, `ProviderAccountLoginStatusSchema` are currently
  `z.literal("openai-codex")`. Change each to `z.enum(["openai-codex", "anthropic-claude"])`. Add the
  `anthropic-claude` / `managed-subscription` variant to `ProviderCredentialBindingSchema`'s union
  alongside the existing `openai-codex` variant.
- apps/control-plane/src/account-login-flow.ts: literal `"openai-codex"` types become
  `"openai-codex" | "anthropic-claude"` throughout (AccountLoginIdentity.providerId, gateway callback
  parameter types). No other logic changes — the flow is already provider-agnostic.
- apps/control-plane/src/model-gateway-client.ts and apps/model-gateway/src/main.ts /
  apps/model-gateway/src/gateway.ts: mirror however `codex` (CodexOAuthClient/CodexAppServerClient) is
  wired as an optional named gateway dependency with startAccountLogin/accountLoginStatus/
  cancelAccountLogin dispatch by providerId — add `claude` the same way, dispatching to
  ClaudeOAuthClient when providerId is "anthropic-claude". Persist Claude OAuth tokens through the same
  credential-store mechanism used for Codex tokens (see apps/model-gateway/src/credential-store*.ts and
  apps/control-plane/src/codex-token-resolver.ts if present — read it and mirror as
  claude-token-resolver.ts before assuming the shape).
- apps/control-plane/src/composition/provider-access.ts and any composition file that registers the
  Codex plugin/account ref must register the Claude subscription plugin/account ref the same way.
- apps/carnegie/src/lib/provider-account-login.ts: `PROVIDER_AUTH_HOSTS` must add exactly
  "claude.ai" (only that host is used for the authorize redirect the renderer opens; the token exchange
  happens server-side in claude-oauth.ts, never in the renderer).
- apps/carnegie/src/views/Settings.tsx: add an Anthropic/Claude login button next to the existing
  ChatGPT/Codex login button, reusing the exact same login/poll/cancel/logout UI flow component with
  providerId "anthropic-claude" instead of "openai-codex".
- apps/carnegie/electron/apiBridge.ts / preload.cts / global.d.ts: these are almost certainly already
  generic over providerId (verify by reading, do not assume) — only touch them if a literal type there
  is unnecessarily narrowed to "openai-codex" alone.

## Constraints (same discipline as the router work)

- No secrets/tokens in logs, contracts, or UI. No plaintext token persistence outside the existing
  credential-store abstraction already used for Codex tokens.
- Exact provider/model identity discipline: "anthropic" (api-key) and "anthropic-claude"
  (managed-subscription) remain distinct identities, matching the existing "openai" vs "openai-codex"
  split. Do not merge them.
- TDD: write failing tests first for every file touched, run them red, implement minimal code, run
  green, then move to the next slice. Use the exact focused test commands the router work used
  (npm test -- <file...>) plus affected tsc -b packages, eslint, prettier --check, git diff --check
  before each commit.
- Read the actual current file before editing; do not assume the literal Codex code structure without
  checking — Maestro's real files (not the ported reference) are the source of truth for how to wire
  things; the reference file is ONLY the source of true OAuth endpoint/client_id/scope facts.
- Do not touch apps/carnegie/src/components/WindowChrome.tsx or unrelated router files.
