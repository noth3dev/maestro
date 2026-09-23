# Carnegie Ensemble Router and Concertmaster Model Selection

## Goal

Make the PostgreSQL-backed Ensemble Router operational and let an operator choose an exact Concertmaster model before creating a new conversation. The router must discover live provider models while keeping human-reviewed profiles, explicit candidate membership, account bindings, and the operator's enabled pool separate.

## Scope

This change covers:

- Control Plane router-catalog composition and readiness.
- Local bootstrap propagation of routing configuration to the spawned Control Plane.
- Exact Concertmaster model selection for new Carnegie conversations.
- Provider-advertised reasoning-effort metadata and persistence in the new Conversation binding.
- Fail-closed status and user-visible blocked states when live models, reviewed profiles, candidate configuration, or account authorization are unavailable.

It does not authorize provider calls, Goal/Worker execution, external effects, or E6 execution without the separate E5 live gate.

## Invariants

1. **Exact identity.** A model reference is the exact `provider/model` pair. `openai/*` and `openai-codex/*` are never aliases.
2. **PostgreSQL authority.** Durable Control Plane state is authoritative. No PGlite fallback is reintroduced for this path.
3. **Credential boundary.** Catalogs and model maps contain no plaintext credentials. Tokens stay in the existing encrypted main-process/gateway boundary.
4. **Fail closed.** A candidate is eligible only when its reviewed profile, exact live Gateway model, explicit catalog entry, and configured account binding are all valid.
5. **Immutable conversations.** Model and reasoning effort are selected only when creating a new Conversation. Existing Conversations retain their persisted binding.
6. **No fabricated progress.** Router readiness, provider availability, Task Contracts, Goals, Workers, evidence, and reports are never inferred from configuration alone.

## Runtime layers

The router composes these independent sources:

- **Model map:** human-owned reviewed profiles keyed by exact model reference.
- **Candidate catalog:** explicit credential-free candidate entries with candidate reference, exact model reference, and account binding.
- **Live Gateway catalog:** models currently advertised by the authenticated Model Gateway.
- **Operator pool:** durable enabled candidate references for the current operator.

The composed read reports per-candidate state and an overall status. It is `inactive` when the configured candidate catalog is absent or invalid, `partial` when the live catalog is unavailable or any candidate is absent from the live catalog or has an unauthorized account binding, and `ready` only when all required sources agree. Ensemble mode is active only in the `ready` state.

Live-only models may be visible as unprofiled or unavailable, but they cannot enter the eligible candidate pool without a reviewed profile and explicit catalog entry.

## Bootstrap contract

`ConnectionEnvironment` accepts optional routing fields:

- `MAESTRO_MODEL_ROUTING_MODE` (`ensemble` or `pin`)
- `MAESTRO_NATIVE_MODEL` (exact model reference for pin mode)
- `MAESTRO_ENSEMBLE_CANDIDATE_CATALOG`
- `MAESTRO_MODEL_ACCOUNT_REFS`
- `MAESTRO_MODEL_MAP`

`resolveLocalConnection` forwards these values to `startControlPlane`; `buildLocalControlPlaneEnvironment` forwards them as child-process environment variables. Undefined values are omitted. Values are configuration paths/identifiers only and are not logged as secrets.

## Conversation contract

New Conversation creation accepts an optional exact model reference and optional provider-advertised reasoning effort. The Control Plane asks the Gateway to admit the binding. Gateway admission rejects an unknown model, unauthorized account, or unsupported reasoning effort before provider creation. The opaque Conversation binding stores the exact provider/model/account and selected effort.

The response exposes `reasoningEffort` as a nullable value; older response fixtures may omit the optional field for wire compatibility. No raw provider reasoning or tool arguments are returned to Carnegie.

## Carnegie behavior

Home and Inbox show exact live model identities for new conversations. The reasoning control renders only the selected model's advertised discrete options, supports keyboard and screen-reader use, resets an invalid selection when the model changes, and falls back to the provider default when no metadata is advertised. Once a conversation starts, its model and effort controls are disabled because the binding is immutable.

Unavailable catalog/provider state is rendered as a clear blocked or provider-unavailable state with a retry/reconnect path; the UI does not present example models as live choices.

## Verification and acceptance

Focused tests cover router readiness, live-model/account-binding rejection, bootstrap propagation, provider catalog metadata, Gateway admission, Control Plane persistence, Carnegie model selection, and reasoning-dial behavior. Required checks are:

- `npm test` against the configured real PostgreSQL service.
- `npm run build`.
- `npm run lint`.
- migration, boundary, and `git diff --check` checks.
- live `/v1/models` and new-conversation evidence before claiming provider or E5 success.

Automated green tests do not close E5. E5 remains open until a live, bounded scenario produces real Conversation/Task Contract/Goal/Worker evidence or records the exact first blocker.
