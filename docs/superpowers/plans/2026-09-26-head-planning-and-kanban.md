# Head planning, Encore plan approval, and Kanban — implementation plan

Status: in progress · 2026-09-26 · Design: `docs/superpowers/specs/2026-09-26-crew-team-workflow-design.md`

## Agreed flow

1. **Overture crew → PRD.** The crew delivers `prd.md` (product level). The operator creates, confirms, and launches the Task Contract from it (single launch confirmation). *Done.*
2. **Department Heads meet.** The PRD's departments wake. Each Head submits a sealed brief; a Head that finds its department unnecessary says so and goes back to sleep. After reveal, the Heads discuss (≤ 2 rounds) and agree on the detailed plan: cross-department **phases**, and **slices** named `p<phase>s<n>` (e.g. `p1s22`), each owned by exactly one department with an objective, acceptance criteria, and dependencies.
3. **Encore Council approves the whole plan** before any Worker starts. Adding/removing phases or changing scope needs re-approval; slice changes inside an approved phase are the owning Head's call.
4. **Execution.** Approved slices become Department Plan items → Mission Bundles → Workers; certification as today.
5. **New department types.** A Head may request a department that does not exist; the Encore Council decides; on approval the department definition is added and its Head wakes.
6. **Kanban** replaces the Floor view: slice cards by status (planned → approved → in progress → review → done, with blocked), swimlanes per department, per Goal.

Operator approvals stay at: contract launch, and critical actions. The Heads' meeting is visible in Channel `#head-council` (sealed briefs stay hidden until reveal).

## Slices (in order)

| # | Slice | Status |
| --- | --- | --- |
| 1 | Execution plan data model: `goal_plans`, `goal_plan_phases`, `goal_plan_slices` (+ status), persistence API, contracts, read route (`GET /v1/goals/:goalId/plan`) | done |
| 2 | Kanban view replacing Floor view (reads the Goal plan; empty state until Heads plan) | done |
| 3 | Head brief runtime wired into orchestration: sealed briefs with a `needed` flag; unneeded Heads withdraw (Council protocol) and return to sleep; every permanent Head wakes, the PRD frames each ask; `#head-council` shows each Head's outcome | done |
| 4 | Head meeting: the Overture conversation lead (with its PRD history) chairs a free discussion in `#head-council`, can pause to ask the operator (Overture clarification), drafts the plan; Heads review their slices; one revision; stored as the draft plan | done |
| 5 | Encore plan approval: the draft goes to an Encore review (3 reviewers on the launch model); proceed approves it and its slices; a unanimous rejection gets one lead revision; an escalation (or a second rejection) waits for the operator, who approves or sends it back with a note on the board | done |
| 6 | Dispatch: approved slices → Department Plan items → Mission Bundles; slice status follows Workers/certification | next |
| 7 | New department types: request → Encore decision → department definition → Head wake | |

Each slice: TDD, real PostgreSQL integration tests run alone (never two DB suites at once), build/lint/boundaries, commit.

## Multi-project workspace (done, before slice 4)

- Projects are named; each operator has a **Home** project (the global workspace). Global: Concertmaster (sessions from every project), inbox (approvals from every project), billing (all projects, per-project breakdown). Project-scoped: dashboard, board, planning, channel, flashmob, evidence, persona, luthiery, arrangements, Goals.
- The project dropdown above the profile selects the project; the choice is remembered. Below `ProjectsProvider`, `config.projectId` is the selected project.
- A PRD approved in Home starts its Goal in a **new project** (named from the PRD title); inside a project it defaults to that project. The run records the target project.


## Slice 6 notes (dispatch)

- An approved plan becomes the Council's decision packet (`recordCouncilDecisionPacket`): ownership and worker plan per department from its slices; the packet hash anchors Department Plans.
- Each owning department gets a Department Plan whose items are its slices (`itemId` = slice id, `dependsOn` = slice deps); Mission Bundles per item; Workers dispatch when a slice's dependencies are done.
- Slice status follows the Worker: `in_progress` on spawn, `review` on completion awaiting certification, `done` on certification, `blocked` on failure/escalation.
- Open question: one active session per Head across Goals (unique index) blocks concurrent projects.
