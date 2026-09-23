# Overture Foundation Task 14 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the durable, project-scoped Overture Run and hierarchical plan-set foundation required by E5 Task 14.

**Architecture:** Add strict domain/contracts for six Overture roles, run states, role messages, clarifications, artifacts, plan documents, revisions, and a hash-bound plan manifest. Persist them in PostgreSQL with project/conversation foreign keys, append-only revisions/messages, immutable content hashes, and idempotent command identities. Do not create a Goal, Worker, Mission Bundle, provider effect, or Task Contract yet; those belong to later E5 tasks.

**Tech Stack:** TypeScript, Zod, `@maestro/domain`, `@maestro/contracts`, PostgreSQL, Vitest.

**Spec:** `execution/plan-E5-gui-implementation.md` — integrated Task 14.

## Global Constraints

- PostgreSQL is authoritative; no PGlite substitute counts as live evidence.
- Overture is goal-less and project-scoped until exact Launch.
- Role messages, revisions, and artifacts are append-only.
- Project and conversation boundaries are enforced on every read/write.
- Content hashes use canonical JSON and SHA-256.
- Secrets, provider tokens, raw model reasoning, and raw tool arguments are not persisted.
- Every mutating operation is idempotent by an explicit command identity.

---

### Task 1: Domain Overture model

**Files:**
- Create: `packages/domain/src/overture.ts`
- Create: `packages/domain/src/overture.test.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/src/surface.test.ts`

- [x] Define the six canonical role IDs, role metadata, run states, document kinds, and append-only revision types.
- [x] Define deterministic canonical role ordering and SHA-256 hash helpers for plan documents and manifests.
- [x] Write RED tests for role completeness/order, unknown-role rejection, goal-less authority boundary, canonical hash stability, and manifest tamper detection.
- [x] Implement the smallest immutable domain functions.
- [x] Run `npx vitest run packages/domain/src/overture.test.ts packages/domain/src/surface.test.ts`.

### Task 2: Wire contracts

**Files:**
- Create: `packages/contracts/src/schemas/overture.ts`
- Create: `packages/contracts/src/overture.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/surface.test.ts`

- [x] Define strict Zod schemas for Overture Run, role messages, clarifications, artifacts, plan documents/revisions, plan manifest, and create/append/read inputs.
- [x] Bound text, IDs, lists, metadata, and hashes; reject secrets and model-private content at the contract boundary.
- [x] Write RED tests for strict fields, project/conversation binding, role identity, valid plan00/phase/slice names, and hash formats.
- [x] Implement and run the focused contract tests.

### Task 3: PostgreSQL persistence

**Files:**
- Create: `packages/persistence/migrations/0107_overture_runs_and_plan_sets.sql`
- Create: `packages/persistence/src/overture.ts`
- Create: `packages/persistence/src/overture.test.ts`
- Create: `packages/persistence/src/overture.integration.test.ts`
- Modify: `packages/persistence/src/index.ts`

- [x] Add tables for runs, role assignments, messages, clarifications, artifacts, plan documents, plan revisions, and manifest revisions.
- [x] Add foreign keys to the existing `(conversation_id, project_id)` conversation identity, immutable identity triggers, append-only triggers, project-bound checks, and command uniqueness.
- [x] Write RED PostgreSQL tests for schema constraints, append-only behavior, cross-project rejection, revision hashes, and manifest reconstruction.
- [x] Implement create/read/append/revise operations with transactions and explicit command IDs.
- [x] Add same-conversation and turn identity checks, per-run cursors, concurrent replay serialization, dependency-edge validation, event/outbox replay integrity, and sensitive/raw-model-content rejection.
- [x] Run focused tests and the real-PostgreSQL integration target: **6 suites / 17 tests passed** after the hardening pass.

### Task 4: Evidence and handoff

- [x] Run package typechecks/builds, targeted ESLint, formatting checks, migration numbering checks, and `git diff --check`.
- [x] Record RED/GREEN evidence and known live gaps in `roadmap/act-1-foundation/active/operations/progress.md`.
- [ ] Commit the Task 14 foundation before beginning Task 15 role runtime/routes.
