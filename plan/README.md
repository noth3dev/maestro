# Maestro plans

## Canonical roadmap

The phase documents in this directory are the source of truth for implementation:

1. `phase1.md` — Technical Foundation and Durable Control Plane (accepted)
2. `phase2.md` — Secretary Office Core and Hierarchical Goal Execution (active)
3. `phase3.md` through `phase8.md` — later phases, in numeric order

`extra.md` records the newer architecture naming/specification:

- **Overture** is the Phase 2 intake and framing crew. It replaces the old “Initiator Crew” name.
- **Vanguard** is deferred beyond Phase 2. Do not implement it during current Phase 2 work.

## Feature plans and specifications

Durable feature plans are kept directly under `plan/`. Their design specifications are kept under `plan/specs/`. These paths are the repository source of truth and are independent of any agent or tool-specific folder layout.

- `2026-09-06-maestro-tui.md` — Maestro terminal TUI implementation plan
- `2026-09-07-maestro-native-agent-backend.md` — native runtime and provider gateway plan
- `specs/` — design specifications referenced by the feature plans

## Historical material

`archive/hierarchical-orchestration-design-legacy.md` is the original design-interview record. It is retained only for decision provenance. It is not an implementation plan and must not override the phase documents or `extra.md`.
