# Phase 5 Execution Slices — Runtime, Device, Operator

**Decision date:** 2026-09-05  
**Baseline:** `hardening/lifecycle` at `3580e35`  
**Goal:** turn the Phase 1–4 code-level surface into a genuinely operable Maestro system. Green unit/component tests alone do not count as operational acceptance.

## Source review

The current non-archive plan set was read before this split: `phase1.md` through `phase8.md`, `post-phase8-ideas.md`, `README.md`, and `extra.md`. The active Phase 5 remediation plan is the governing source for operational usability. Earlier “complete” markers are treated as component-level history, not release readiness.

## Council decision

Three Luna reviews compared the Phase 5 Track A/B gaps and agreed on this order:

1. **Runtime first:** Phase 5 Track A item 1 — durable worker/provider ownership and restart recovery.
2. **Device second:** Phase 5 Track B items 1–2 — a real separately-running device-agent authority path. It may implement in parallel with Runtime because it owns separate device tables and packages, but its acceptance follows the Runtime contract review.
3. **Operator third:** Secretary Safety Console and live durable event stream. It consumes the frozen runtime/device read surfaces and must not become a second authority or scheduler.

The ordering prevents a UI from presenting process-local worker state as trustworthy, and prevents multiple independent process/reconciliation protocols from being introduced at once.

## Slice 1 — Runtime provider ownership and recovery

**Owner:** Runtime lane.  
**Scope:** `packages/domain` runtime binding types; `packages/persistence` worker/recovery migration and services; `packages/prime-adapter` only for honest capability boundaries; `apps/control-plane/src/main.ts` lifecycle composition; focused integration/process tests.

Use the existing `workers.execution_ref`/`invocation_ref` as the authoritative identity unless a strict 1:1 projection is proven necessary. Do not create a competing mutable identity table. Add only the durable owner/heartbeat/state/recovery facts required to fence stale work, plus append-only recovery decisions. Reserve before provider effects, bind once, persist terminal state before release, and use two-phase cancellation intent. Never fabricate Prime resume/reconnect or success/cancellation when the provider is unavailable.

Acceptance requires disposable PostgreSQL plus a separately-running process-backed provider harness through the same coordinator/HTTP path: kill the owner, wait for lease expiry, start a successor, prove no duplicate spawn, durable `unknown`/`fenced` or provider-confirmed cancellation, exactly one recovery decision, and retry blocking. A separate `MAESTRO_LIVE_PRIME=1` test may prove Prime compatibility but must not replace deterministic lifecycle evidence. SIGTERM drain must be bounded and SIGKILL must fence conservatively.

## Slice 2 — Device authority path

**Owner:** Security/device lane.  
**Scope:** new device-grant envelope domain/contracts, `packages/device-agent`, `apps/device-agent`, device grant/session persistence, and dedicated device config/key boundary. Do not modify worker runtime bindings or Secretary files. Track B items 3–8 remain explicitly open.

Implement one narrow ordinary project-file action through a separately-running device agent: authenticated TLS with certificate-to-enrolled-device binding and proof of possession; a signed, Goal/project/device/path/fence/policy-bound short-lived grant; local monotonic fence and expiry validation; server-side durable grant/session rechecks; injected bounded executor. Private keys and challenge plaintext never enter PostgreSQL, evidence, logs, or prompts. Missing key, stale Goal/lease/fence, revoked/expired grant, wrong certificate/signature, and scope escape must deny before the OS effect.

Acceptance requires real PostgreSQL and real agent/control-plane processes, ephemeral CA/certificates and Ed25519 keys, actual temp-project effect, restart replay rejection, and negative cases with zero effect. Command outbox/signed result receipts, revocation cascade, typed application/data/network scope, disconnect pause, and Metronome device rules belong to later slices.

## Slice 3 — Secretary safety console and durable stream

**Owner:** Operator lane.  
**Scope:** `apps/secretary`, `packages/api-client` stream/request cancellation seam, CLI parity, and only the minimal existing contracts/routes needed. Do not add a second scheduler, worker state, or browser-held authority.

Provide project-scoped Goal discovery/selection, durable Goal/budget/challenge/certification/report/event reads, existing lifecycle controls, Metronome correction/safe-pause/resolve, and critical-action request/CEO approve-and-run through server-authenticated routes. Add cursor-safe SSE with bounded polling fallback and per-call abort. Browser actions use server-side proxies so bearer credentials do not enter client state. The CLI remains the parity oracle. UI disconnect/abort must affect transport only, never cancel Goal execution.

Acceptance requires a real control-plane process, real PostgreSQL, real `next start` process and Playwright interaction: identical CLI/API/UI durable state, one event per command, cursor reconnect without loss/duplication, explicit stale/recovery state, safe disabled/error controls, and critical approval effect exactly once according to the durable authority boundary. Runtime/device failures must be shown as unknown/recovery, never inferred from missing events.

## Cross-slice gates

- Each slice owns its migrations/files and must not duplicate another slice's identity or scheduler.
- Every external effect has a durable scoped authority decision/claim and a real adapter; missing adapters fail closed.
- Every write carries authenticated actor/session/project/Goal identity, exact role where required, command identity, and current Goal lease/fencing proof.
- Every ambiguous provider or transport outcome is durable unknown/recovery, never false success.
- Each slice gets focused tests, `npm run build`, PostgreSQL-backed `npm run check`, independent no-edit review, a Conventional Commit, and a pushed branch before integration.
- `main` is updated only from a freshly verified integration result. A branch push without a green full check is not a release claim.
