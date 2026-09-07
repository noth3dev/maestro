# Maestro plans

## Canonical roadmap

The phase documents in this directory define the intended implementation order. The current execution pointer and evidence are maintained in the root `task_plan.md`, `progress.md`, and `findings.md`:

1. `phase1.md` — Technical Foundation and Durable Control Plane (code baseline; operational gates remain)
2. `phase2.md` — Secretary Office Core and Hierarchical Goal Execution (code baseline; operational gates remain)
3. `phase3.md` and `phase4.md` — oversight, certification, environments, devices, and incident workflows (code baseline; live acceptance remains)
4. `phase5.md` — Concurrent Goals and Portfolio Control (partial capacity/remediation work)
5. `phase6.md` through `phase8.md` — later phases, in numeric order

**Current implementation pointer (2026-09-07):** the native runtime/model gateway serves conversations, and durable ChatGPT account-login recovery is integrated. Worker execution still composes the legacy Prime adapter. Do not mark the native backend or the first usable release accepted until the phase-specific PostgreSQL, process-recovery, authority, and usability gates pass.

`extra.md` records the newer architecture naming/specification:

- **Overture** is the Phase 2 intake and framing crew. It replaces the old “Initiator Crew” name.
- **Vanguard** is deferred beyond Phase 2. Do not implement it during current Phase 2 work.

## Feature plans and specifications

Durable feature plans are kept directly under `plan/`. Their design specifications are kept under `plan/specs/`. These paths are the repository source of truth and are independent of any agent or tool-specific folder layout.

- `2026-09-06-maestro-tui.md` — Maestro terminal TUI implementation plan (conversation-first slice next)
- `2026-09-07-maestro-native-agent-backend.md` — native runtime and provider gateway plan (worker Prime removal still open)
- `specs/` — design specifications referenced by the feature plans

## Historical material

`archive/hierarchical-orchestration-design-legacy.md` is the original design-interview record. It is retained only for decision provenance. It is not an implementation plan and must not override the phase documents or `extra.md`.
