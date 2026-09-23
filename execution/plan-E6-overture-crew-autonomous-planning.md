# E6 Overture Crew and Autonomous Planning

> **Status: integrated into E5.** This file is retained as a compatibility pointer so old links do not silently recreate a second execution plan. It is not an independent plan and must not be executed separately.

The Overture Crew, interactive planning conversation, hierarchical plan set, Task Editor, exact Task Contract handoff, and post-launch automatic orchestration are now part of the single authoritative E5 execution plan:

- `execution/plan-E5-gui-implementation.md` — Tasks 14–20

## Integrated task mapping

| Former E6 area | Authoritative E5 task |
|---|---:|
| Overture contracts, durable Run, artifacts, clarifications, plan persistence | Task 14 |
| Role-specific models/prompts/tools and same-channel interactive Crew | Task 15 |
| Exact Launch and automatic Goal orchestration | Task 16 |
| Live Overture → `plan00` → phase/slice plans → Task Contract → Goal evidence | Task 17 |
| Final integrated verification and E5 completion gate | Task 18–20 |

## Non-negotiable interaction model

Concertmaster owns the operator conversation. When planning is required, it awakens a project-scoped Overture Crew. The roles participate in the same durable conversation with explicit identity, role-specific model policy, tools, and authority boundaries. They question the operator, investigate the repository, research, review security, produce design options, and challenge incomplete assumptions. The Task Editor incrementally writes:

1. `plan00.md` — whole-project overview, stack, architecture, invariants, and phase map.
2. `plan01.md`, `plan02.md`, … — phase plans.
3. `plan01-slice01.md`, `plan01-slice02.md`, … — multiple implementation slices within each phase.

A Task Contract is created only after the plan set is sufficiently complete, its manifest is hash-bound, and the operator reviews and confirms the exact version. Launch is the only boundary that may create/attach a Goal and begin automatic orchestration.

Do not add a one-shot Task Contract producer, hidden batch role reports, manual downstream identity entry, or a second Overture authority path.

## Current evidence checkpoint (2026-09-23)

Task 14's durable foundation is implemented but remains uncommitted. Its real-PostgreSQL focused gate passed **6 files / 17 tests**, with build/typecheck, targeted lint, formatting, migration numbering, and diff checks green; an independent no-edit re-review returned **PASS**. The unrestricted `npm test` is running as the next verification item. This pointer remains archival: Task 15 must continue only through `execution/plan-E5-gui-implementation.md`, and no E6 runtime or post-Launch work may begin before E5 Task 14 is committed and reviewed. The live provider/Home boundary still has no Task Contract or downstream Goal/Worker evidence.


The final Task 14 verification also passed the unrestricted real-PostgreSQL suite (**435 files / 2,888 tests**) and the hardened focused gate (**6 files / 17 tests**). This does not open E6: the foundation is ready for commit, but Task 15 and all former E6 runtime work remain behind the E5 Task 14 commit/review gate, and live Home/provider evidence still lacks a Task Contract and downstream execution identities.
