# Dynamic Codex model catalog

## Decision

When the Codex app-server is configured and no explicit `MAESTRO_CODEX_MODELS` allowlist is supplied, Maestro discovers the provider catalog through the public `model/list` method. It follows every `nextCursor` page, excludes hidden entries requested out of the default picker, normalizes the provider model ID, and exposes only validated identities through the existing gateway catalog.

`MAESTRO_CODEX_MODELS` remains an explicit restrictive override. It is never replaced by a guessed or hardcoded current model name. If discovery fails without an override, the gateway returns a truthful provider-unavailable error and exposes no fabricated Codex model.

## Boundaries and invariants

- The Codex app-server remains the owner of account OAuth, refresh tokens, and provider model truth.
- Maestro receives model metadata only; it does not infer or mint model identities.
- Gateway model listing refreshes provider catalogs before credential filtering; admission refreshes again before exact model resolution.
- Provider credentials remain operator-owned and model selection remains an exact `provider/id` choice.
- Static OpenAI and Anthropic catalogs keep their existing environment fallback behavior.
- Pagination is bounded, deduplicated, and rejects malformed or looping cursors.

## Alternatives rejected

1. A narrow Codex-owned `model/list` client plus an optional provider refresh hook: selected because it fixes discovery and admission with a small surface.
2. An async catalog migration for every provider: rejected as unnecessary cross-provider regression scope.
3. TUI-only opportunistic discovery beside the gateway: rejected because it could display models that admission cannot authorize.

## Acceptance criteria

- Visible models from every successful `model/list` page appear in `/models list` and gateway `/v1/models` when the operator has an active Codex binding.
- Hidden entries, duplicate IDs, malformed entries, invalid cursors, provider errors, and missing catalogs behave deterministically without invented models.
- An explicit allowlist remains restrictive and does not alter credential, approval, cancellation, or conversation ownership boundaries.
- Existing static-provider and Codex login tests remain green.
