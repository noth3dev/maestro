# Phase 5 scenario runbook — three-Goal, two-project concurrent portfolio

**Status: harness only.** This runbook and the fixtures in this directory
exist to support the plan-5 §5 HANDOFF live acceptance walkthrough. They do
**not** constitute a live/production acceptance run. `test/phase5-scenario/contention.integration.test.ts`
proves the harness's own mechanics against real PostgreSQL and the real
`@maestro/domain` / `@maestro/persistence` §S2–§S4 APIs. It does not drive a
live model provider, a live Discord webhook, or a live Control Plane HTTP
deployment end to end. Do not read a green run of that test as a substitute
for the live gate below — see `execution/PENDING_LIVE_CHECKS.md` for how live
gaps are tracked in this repository.

## Fixtures

- `projects.json` — two disposable fixture projects (`project-alpha`,
  `project-beta`).
- `goals.json` — three Goal definitions across those two projects, a
  capacity inventory tight enough to force contention (2 worker slots per
  project against 2 Goals contending in `project-alpha` alone, before the
  third demand from `project-beta` is even counted), the CEO pin
  (`goal-beta-1`), and the seeded Discord safety event definition
  (critical severity, 0.97 confidence, linked to `goal-beta-1`).
- `contention.integration.test.ts` — the CI-runnable harness-mechanics
  proof. Requires `MAESTRO_TEST_DATABASE_URL` (real PostgreSQL); skips
  itself otherwise, matching the convention used throughout this
  repository's other `*.integration.test.ts` files.

## 🙋 Live acceptance walkthrough (user-run, per plan-5.md §5 HANDOFF)

The eight steps below are the live acceptance gate. Each step names the
fixture, real API, or table that backs it, and the harness test that
exercises the same mechanic offline. Run these against a real deployed
Control Plane, real PostgreSQL, and (per plan-5.md's scope) whatever
provider/Discord integration the live environment actually has configured
— this harness does not supply either.

1. **Start three Goals across two projects with capacity constrained below
   their combined demand.**
   Use `goals.json`: create `goal-alpha-1` and `goal-alpha-2` in
   `project-alpha` (capacity ceiling: 2 worker slots) and `goal-beta-1` in
   `project-beta`. Combined demand across the portfolio (3 worker slots)
   exceeds any single project's 2-slot ceiling once a third demand lands on
   the same project.
   *Offline proof: `contention.integration.test.ts` "E1" reserves capacity
   for `goal-alpha-1` and `goal-alpha-2` in `project-alpha`, then shows a
   third demand queues.*

2. **Watch contention occur — confirm admissions queue rather than
   degrade.**
   Inspect `capacity_reservations.status = 'queued'` and
   `capacity_reservations.queue_reason`. Confirm `requirement` on the
   queued row is unchanged from what the Goal declared (never silently
   lowered to fit).
   *Offline proof: same "E1" test asserts `{ kind: "queued", reason:
   "provider_rate" }` with `requirement: "high"` preserved end to end.*

3. **Confirm the Portfolio Council records an evidence-backed decision.**
   Trigger a `capacity_conflict` or `incident_preemption` Portfolio Council
   round via `decidePortfolioCouncil` / `recordPortfolioCouncilDecision`
   (see `packages/domain/src/portfolio-council.ts` and
   `packages/persistence/src/portfolio-council.ts`). Confirm
   `portfolio_council_rounds` gained one append-only row with
   `evidence_references` bound to durable `evidence_records` rows for the
   captured Goals.
   *Offline proof: "E2/E5/E6" test records a real decision and asserts its
   evidence references round-trip from Postgres.*

4. **Let it pause one Goal; confirm the pause lands at a safe point.**
   Use the Council action with `disposition: "pause"` and
   `executionFence` for `goal-alpha-2`, whose declared `safePausePoint` is
   `after-scout-handoff`. Confirm the released allocation is `{0,0,0}` and
   the prior fencing token can no longer be used to write.
   *Offline proof: "E3" test shows the same fence-advance shape and that
   pause produces zero new evidence rows.*

5. **Resume that Goal; confirm no duplicate work — compare durable evidence
   counts before and after.**
   Record `SELECT count(*) FROM evidence_records WHERE goal_id = $1` before
   pause and again after resume plus one unit of genuinely new work.
   Confirm the count is unchanged across the pause window and increases by
   exactly the new work's own evidence, not by anything replayed.
   *Offline proof: "E3" test asserts the evidence count is identical across
   the pause window, then increases by exactly one new row after resume.*

6. **Pin a Goal as CEO; confirm the Council does not pause it.**
   Set `ceoPinned: true` for `goal-beta-1` (already declared in
   `goals.json`) and submit a Council round proposing to pause or
   deprioritize it with no Discord safety event present. Confirm the
   Council rejects the round outright.
   *Offline proof: "E5" test asserts `decidePortfolioCouncil` throws
   `CEO-pinned Goal … cannot be paused or deprioritized` for exactly this
   shape.*

7. **Fire the Discord safety event; confirm preemption takes precedence and
   is recorded.**
   Seed (or, in the live environment, receive) a `critical`-severity,
   `0.97`-confidence Discord incident linked to `goal-beta-1` — the same
   CEO-pinned Goal from Step 6. Submit a Council round with that
   `discordPreemption` populated. Confirm the recorded decision's
   `precedence` is `discord_safety_preemption` and `goal-beta-1`'s action is
   rewritten to `preempt` with a released allocation, overriding the pin.
   *Offline proof: "E2/E5/E6" test performs exactly this preemption and
   asserts the durable record's `precedence` and `discordPreemption`
   fields.*

8. **Inspect all three Goals for boundary crossings: context, authority,
   budget, Git, evidence, certification.**
   For each pair of Goals (including same-project pairs), confirm no
   context pack, budget reservation, authority grant, Git worktree,
   evidence record, or certification recorded for one Goal is readable or
   reusable from another Goal's scope.
   *Offline proof: "E4" test shows evidence and capacity reservations do
   not cross `project-alpha` / `project-beta`, and plan-5 §S1's
   `goal-isolation-proof` suite (already merged) covers the remaining
   axes named in C2.*

## Stop conditions

Per plan-5.md §5, halt and record a finding immediately if any of the
following occurs during the live walkthrough:

- any queued admission proceeds with a lowered requirement;
- any resumed Goal repeats proven work;
- any cross-Goal visibility is observed;
- a CEO-pinned Goal is paused by the Council with no Discord safety
  override present;
- a below-requirement model is authorized by capacity pressure alone.

Record the outcome — pass or stop condition — in
[`../../roadmap/act-1-foundation/active/operations/findings.md`](../../roadmap/act-1-foundation/active/operations/findings.md).
