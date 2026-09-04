# Phase 5 — Concurrent Goals and Portfolio Control

## Outcome

Allow multiple Goals and projects to run concurrently without mixing context, authority, budgets, workers, Git, evidence, or certification. When capacity conflicts, affected Heads and Encore make an evidence-backed portfolio decision while respecting CEO-pinned priority and safe pause points.

## Isolation unit

Every active Goal owns separate:

- Task Contract and amendments;
- Head Council participation and transcripts;
- Department Plans and plan versions;
- context packs and project-private evidence;
- budgets, reservations, spend, and recovery reserve;
- authority grants and critical approvals;
- Prime Agent invocation bindings and workers;
- environments and device grants;
- Git base, branches, worktrees, and integration revision;
- Metronome findings, Council judgments, certifications, and reports;
- radial-tree sector and notifications.

A persistent Head may participate in multiple Goals, but each participation is a separate runtime context. Durable Department knowledge can inform another Goal only through approved knowledge boundaries.

## Capacity model

Track capacity by constrained resource rather than one global worker count:

- model/provider rate and spend;
- Department Head attention;
- worker slots by risk class;
- CPU, memory, storage, browser, and environment resources;
- enrolled-device exclusivity;
- repository/worktree conflicts;
- Quality, Security, Safety, and Council validation capacity;
- recovery reserve.

A Goal declares expected demand and safe pause points. The scheduler admits work only when protected validation and recovery floors remain available.

## Portfolio Council

Invoke when Goals compete materially or an incident proposes preemption.

Participants:

- affected Department Heads;
- Encore evidence providers and adjudicators as required;
- Concertmaster as coordinator and reporter.

Inputs:

- CEO-pinned priority and deadlines;
- severity, confidence, and reversibility;
- expected value and cost of delay;
- completion probability and remaining cost;
- interruption cost and safe pause point;
- resource contention;
- Quality and safety risk;
- prior performance and current evidence;
- Discord incident urgency;
- opportunity cost.

Outputs:

- ordering and concurrency decision;
- allocations and protected floors;
- Goals to continue, queue, pause, or preempt;
- exact safe pause points;
- reconsideration triggers;
- confidence, dissent, and CEO-visible schedule effects.

A CEO-pinned Goal cannot be silently deprioritized. Immediate credible safety risk may cause a temporary safe pause before Council, but sustained reallocation follows the recorded decision.

## Scheduler behavior

1. Reconcile all Goal truth and leases.
2. Calculate available capacity and protected floors.
3. Admit ready missions whose dependencies and authority are satisfied.
4. Prefer safe parallel work inside separate ownership boundaries.
5. Reserve validation and recovery capacity before execution expansion.
6. Queue rather than degrade all active Goals when capacity is exhausted.
7. Reforecast at milestones and significant failures.
8. Pause at declared safe points; fence old workers before reallocating.
9. Resume from durable plan items and evidence without repeating completed work.
10. Emit portfolio events and update Concertmaster reports.

Use deterministic scheduling for hard constraints. Use Council judgment for value, uncertainty, and tradeoffs. A model never writes scheduler state directly.

## Cross-Goal knowledge rules

- Goal transcripts and project-private data never merge because the same Head participates.
- Shared durable knowledge contains curated generalized lessons only.
- Retrieval records source, scope, freshness, and permission.
- A Head must be able to explain which cross-Goal lesson influenced a decision.
- Revoked or deleted project evidence becomes unavailable to future retrieval.

## Work sequence

1. Generalize single-Goal schedulers, leases, budgets, and projections by Goal identity.
2. Add resource inventory, demand reservations, protected floors, and admission control.
3. Implement per-Goal Prime Agent context and child binding isolation.
4. Implement repository and device exclusivity constraints.
5. Implement safe pause-point declarations and preemption protocol.
6. Implement Portfolio Council input packet, independent Head impact statements, decision, and dissent.
7. Implement CEO pinning and incident-priority behavior.
8. Implement per-Goal and portfolio forecasts in app and CLI.
9. Add concurrency, starvation, fairness, and contamination tests.
10. Run competing-Goal live scenario with pause and resume.

## Failure and edge cases

- Same Head receives two Goal messages in one session: reject; use separate participation sessions.
- Two Goals enroll the same mutable repository path: isolate by worktree or serialize exclusive operation.
- Two Goals request one device: schedule explicit exclusive grants.
- Provider throttles unexpectedly: reforecast and queue; do not steal validation reserve.
- Paused worker continues: revoke grant and fence token before reallocating.
- High-priority Goal repeatedly starves others: apply recorded reconsideration and aging rules unless CEO pin forbids.
- Discord incident is low-confidence: gather bounded evidence before disruptive preemption.
- Portfolio decision depends on private evidence from another project: use only allowed generalized signal.
- Goal completes while queued for Council: reconcile and cancel obsolete decision work.

## Tests

1. Run two Goals with identical Head roles and prove transcript isolation.
2. Attempt cross-Goal evidence, grant, budget, and Git access and prove denial.
3. Exhaust worker capacity and prove new work queues without dropping active validation.
4. Pause at a safe point and prove no new writes after fencing.
5. Resume without repeating completed plan items.
6. Competing device grants never overlap.
7. CEO-pinned Goal is not silently displaced.
8. High-confidence incident triggers safe pause and Portfolio Council.
9. Low-confidence incident does not cause unbounded preemption.
10. Recent relevant outcome evidence influences forecast while stale unrelated evidence does not dominate.
11. Failed or stopped Goal releases capacity exactly once.
12. Portfolio view in app and CLI matches durable allocations and decisions.
13. Run three representative Goals and demonstrate bounded fairness and independent certification.

## Exit gate

At least three Goals across two projects run under constrained capacity. The Portfolio Council records an evidence-backed decision, safely pauses one Goal, reallocates resources, and later resumes it without duplicate work. No context, authority, budget, Git change, evidence, or certification crosses Goal boundaries. CEO-pinned priority and Discord safety preemption behave exactly as declared.

## Requirements preserved in this phase

### 53. Concurrent Goals and project isolation

- Multiple Goals and projects may run concurrently within system, budget, and Department capacity.
- Each Goal has isolated Council state, context, budget, authority, environments, Git hierarchy, worker identities, evidence, and radial-tree sector.
- A persistent Department Head may participate in more than one Goal, but each participation uses a separate Goal context and does not merge transcripts or project-private data.
- Durable Department knowledge may inform multiple Goals only under the agreed project and cross-project knowledge boundaries.
- When safe concurrency capacity is exhausted, new Goals queue rather than degrading all active Goals.
- A high-confidence severe Discord incident may preempt ordinary work under an explicit priority and safe-pause process.
- Concertmaster coordinates portfolio priority, forecast, and CEO reporting. Encore observes whether concurrency harms quality, cost, latency, recovery, or context isolation and may refine bounded concurrency policy.

### 54. Encore and Department Heads decide portfolio priority

Goal priority, resource contention, and preemption are decided by a selective **Portfolio Council** composed of Encore and only the Department Heads materially affected by the competing Goals.

- Concertmaster supplies current Goal commitments, CEO intent, deadlines, blockers, Task Contracts, forecasts, and consequences of delay, and chairs the process without unilaterally setting priority.
- Affected Department Heads independently state operational cost, dependency, interruption risk, safe pause points, and expected value from their Department perspective.
- Encore supplies cross-Goal evidence: severity, confidence, historical outcomes, cost, token use, quality, risk, opportunity cost, resource contention, and likely system-wide consequences.
- The Council decides ordering, concurrency, resource reallocation, pause points, and review time. The decision records evidence, dissent, confidence, and reconsideration triggers.
- A CEO-pinned Goal remains an explicit authority constraint and cannot be silently deprioritized.
- A credible immediate safety, security, or data-loss signal may trigger an automatic safe pause before deliberation. The Portfolio Council then decides the sustained response and resource plan.
- Only affected Heads are awakened. Routine Encore improvement work yields to active CEO Goals unless the improvement is itself required to restore safe operation.
- Concertmaster executes the portfolio decision and reports material schedule effects to the CEO.
