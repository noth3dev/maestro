# Maestro Roadmap

This directory is the planning and evidence map for Maestro. It is organized by delivery **Act**, while preserving the live execution ledger, implementation plans, design specifications, and historical decisions.

## Acts

| Act                                                | Focus                                                                                                                               | Entry point                   |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| [Act 1 — Foundation](act-1-foundation/README.md)   | Durable control plane, hierarchical execution, certification, environments, portfolio, learning, UI, hardening, tools, and treasury | `act-1-foundation/README.md`  |
| [Act 2 — Flashmob](act-2-flashmob/README.md)       | Fast path for bounded, low-risk light tasks                                                                                         | `act-2-flashmob/README.md`    |
| [Act 3 — Arrangement](act-3-arrangement/README.md) | Certified, lineage-aware self-modification and personalization                                                                      | `act-3-arrangement/README.md` |

Acts are sequential. Act N begins only after Act N−1 is certified unless an explicit exception is recorded.

## Current source of truth

- **Current execution pointer:** `act-1-foundation/active/operations/task_plan.md`
- **Execution evidence:** `act-1-foundation/active/operations/findings.md`
- **Append-only progress log:** `act-1-foundation/active/operations/progress.md`
- **Operating protocol:** [`../docs/OPERATING_PROTOCOL.md`](../docs/OPERATING_PROTOCOL.md)

When historical documents disagree with the repository, trust current source evidence and record the reconciliation in the live operations ledger.

## Current status (2026-09-08)

The native runtime and model gateway serve conversation and Worker execution. Prime Agent and its adapter are removed. Durable ChatGPT account-login recovery is integrated. A clean single-worker PostgreSQL run passed 162/162 files and 1066/1066 tests. The Phase 2 production host-tool decision is now defined as a Prime-style persistent IPython surface for local files, Git, tests, shell, and local environment changes with a four-level approval hierarchy. The typed `ipython` registration now exists, but persistent execution and authority enforcement are still fail-closed and not yet implemented; Phase 4 separately owns individually activated external capabilities, and Phase 6 self-improvement remains deferred beyond its accepted digest slice.

## Act 1 organization

- `phase-01-...md` through `phase-10-...md` — ordered foundation phases.
- `active/` — current implementation plans and the Act 1 execution record.
- `specs/` — design specifications referenced by active plans.
- `archive/` — historical design provenance that does not override current plans.
- `../_meta/` — cross-act naming and provenance metadata.

## Reading order

1. Read this index.
2. Read the relevant Act README.
3. Read the phase document for the work.
4. Read `act-1-foundation/active/operations/task_plan.md` and its evidence logs before changing implementation.
5. Read the linked design specification when an active plan references one.
