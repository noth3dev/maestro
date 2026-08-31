# Phase 3 — Overwatch, Independent Certification, and First Usable Release

## Outcome

Complete the first usable Maestro by adding continuous Sentinel observation, selective Council adjudication, independent Quality certification, and an evidence-backed CEO report. The complete Phase 1–3 system must pass one real Goal with forced restart and critical-action denial.

Overwatch is outside the production command hierarchy. It observes and judges; it does not own product direction, rewrite Department Plans, or spawn production workers.

## Overwatch components

### Sentinel

Sentinel consumes durable events and evidence from:

- Task Contract and amendments;
- Head activation and independent briefs;
- Council rounds and decision packet;
- Department Plans and revisions;
- worker assignments, messages, tools, costs, and outcomes;
- Git branches, commits, diffs, integration, and tests;
- authority decisions, denied actions, grants, leases, and recovery;
- certification findings and evidence hashes.

Use deterministic rules first. Model judgment is reserved for ambiguity such as unsupported reasoning, circular discussion, or semantic divergence.

Sentinel detects:

- missing expertise;
- duplicated or cyclic activation;
- unsupported claims;
- circular discussion and stalled handoffs;
- work without an active plan item;
- stale workers against superseded plans;
- hidden scope, budget, or authority growth;
- mismatch between Task Contract, Council decision, Department Plan, and execution;
- missing or corrupt evidence;
- unreviewed integration;
- unresolved blocking certification findings.

Sentinel may attach evidence, challenge, request a bounded correction, or request a safe pause. It cannot choose creative product direction or certify its own challenge as resolved.

### Selective Overwatch Council

Invoke when:

- Goal crosses Departments materially;
- Head disagreement remains material;
- uncertainty is high;
- Sentinel or a Head submits a valid challenge;
- certifications conflict;
- a new Department or wider improvement authority is proposed.

Flow:

1. Freeze the question, evidence set, criteria, and deadline.
2. Spawn independent Council reviewers in isolated contexts.
3. Use genuinely different approved models when available.
4. Collect judgments before revealing peer answers.
5. Record actual model and provider identity.
6. Compare reasoning, evidence, confidence, conditions, and dissent.
7. Produce a synthesis without deleting minority objections.
8. If material uncertainty remains, escalate options and reason to CEO.
9. Route an executable decision through Sane and responsible Heads.

If model diversity is temporarily unavailable, routine local work may use isolated reviews from the available model. The result must say `same-model independent review`; it must not claim multi-model review. If high consequence or material disagreement combines with low confidence and insufficient diversity, escalate to CEO. Missing diversity alone must not stop safe routine work.

## Independent certification

Required certification authorities:

1. Executing Heads accept Department worker outputs and integration.
2. Quality validates the integrated Goal revision against the exact Task Contract and Department Plans.
3. Security and Safety & Compliance participate when risk requires them.
4. Sentinel certifies process integrity, lineage, authority, budget, evidence completeness, and no unresolved blocker.
5. Sane reports success only when all required certifications bind to the same Task Contract identity and integrated revision.

Quality runs tests independently and may add adversarial, integration, accessibility, performance, or security checks. A worker's green test output is evidence, not final certification.

Conflicting certifications route to Council. A waived noncritical finding must record authority, reason, consequence, expiry, and follow-up. Critical safety or correctness findings cannot be waived merely to close the Goal.

## Evidence bundle

The final immutable bundle contains:

- Task Contract content identity and launch confirmation;
- activated organization and reasons;
- Head briefs, decision packet, dissent, and Council result if invoked;
- Department Plan versions and fulfilled items;
- worker assignments, active persona versions, actual models, skills, tools, costs, and termination;
- Git base, branches, commits, diffs, integrated revision, and cleanup state;
- commands, tests, live behavior, artifacts, and content hashes;
- authority decisions, grants, denials, and critical-action attempts;
- restart and recovery evidence;
- each certification and unresolved limitation;
- Sane's final report.

## Sane final report

The report is concise by default and links to detail. It states:

- what the CEO asked for;
- what changed and where;
- whether user-visible behavior passed;
- which Departments and workers participated;
- important decisions and dissent;
- independent validation performed;
- cost versus budget and major reallocations;
- incidents, retries, recovery, and denied actions;
- known limitations and deferred effects;
- whether any critical action remains awaiting approval.

Do not report success from completion percentage or worker self-report.

## Work sequence

1. Implement the Sentinel event consumer and deterministic rule catalog.
2. Implement challenges, evidence attachments, correction requests, and safe-pause requests.
3. Implement semantic review prompts with fixed criteria and isolated context.
4. Implement Council trigger policy, reviewer spawning, sealed judgments, actual-model records, synthesis, and escalation.
5. Implement Department acceptance and independent Quality missions.
6. Implement conditional Security and Safety certifications.
7. Implement certification conflict adjudication and bounded waivers.
8. Implement evidence-bundle assembly and integrity verification.
9. Implement Sane milestone and final reporting.
10. Build adversarial fixtures for unsupported claims, fake consensus, seeded defects, missing evidence, and unauthorized push.
11. Run the complete live release scenario.

## Failure and edge cases

- Sentinel process stops: execution continues only within configured observation-loss tolerance; beyond it, safely pause affected Goals.
- Sentinel repeats a challenge: deduplicate by Goal, rule, evidence identity, and active plan version.
- Model judge output lacks evidence: classify as unsupported and do not escalate its confidence.
- Council reviewer sees a peer answer early: invalidate that independence lane.
- Council uses one model family: label limitation and apply escalation rule.
- Council never converges: preserve options and escalate; never manufacture majority certainty.
- Quality environment cannot reproduce worker test: certification remains blocked.
- Integrated revision changes after Quality starts: invalidate the certification run.
- Evidence artifact hash changes: reject the bundle.
- A Head marks all plan items complete but Goal behavior fails: Goal fails.
- Restart occurs during Council or certification: resume from durable sealed submissions without duplicate reviewer or test mutation.

## Tests

1. Every Sentinel rule fires on a seeded violation and remains silent on a valid fixture.
2. Unsupported natural-language claim triggers semantic review with cited evidence.
3. Duplicate challenge is idempotent.
4. Safe pause prevents new writes but preserves evidence and resumability.
5. Routine one-Department work does not invoke Council unnecessarily.
6. Cross-Department material disagreement invokes Council.
7. Reviewer contexts are isolated until judgment submission.
8. Same-model fallback is labeled honestly.
9. Low-confidence high-risk result with insufficient diversity escalates.
10. Seeded implementation defect blocks Quality certification.
11. Producer cannot issue the independent Quality certification.
12. Certification binds to exact Task Contract and integrated commit.
13. Changing either invalidates certification.
14. Missing or corrupt evidence blocks final report success.
15. Forced restart during worker execution, Council, and Quality creates no duplicate accepted action.
16. Unauthorized remote push is blocked below the agent tool layer.
17. Full evidence bundle can be replayed to reconstruct the final decision.
18. App and CLI show the same challenge, Council, certification, and report state.

## First usable release live gate

Run all steps in one clean scenario:

1. CEO requests a real local software change in plain language.
2. Sane creates the Task Contract through minimal intake.
3. Nothing executes before one exact launch confirmation.
4. Only necessary Heads wake and independently brief.
5. Head Council decides and every active Head writes a Department Plan.
6. Workers modify and test a disposable isolated project through native Prime Agent hierarchy.
7. Sentinel observes all events.
8. Inject one unsupported assertion or qualifying disagreement; Council handles it and records actual model diversity.
9. Quality independently tests the integrated revision and catches a seeded defect in the negative run.
10. Repeat with the defect repaired and obtain all required certifications.
11. Force a control-plane restart during execution; reconcile without loss, duplicate worker writes, or stale authority.
12. Attempt remote push without approval and prove no remote invocation occurs.
13. Sane reports outcome, evidence, cost, dissent, recovery, and limitations.

Static parsing, mocked Council answers, screenshots, and worker-reported tests cannot satisfy this gate.

## Exit gate

All thirteen live steps pass. No critical finding remains open. The evidence bundle reconstructs every material decision and effect. The first usable Maestro may then be used for bounded local Goals; external devices, Firefly, multiple concurrent Goals, automatic improvement, and the full radial interface remain disabled.

## Requirements preserved in this phase

### 3. Department Head Council and Overwatch separation

- Awakened Department Heads form a Goal-scoped Head Council.
- The Head Council discusses scope, dependencies, risks, options, ownership, and validation criteria before workers are spawned.
- Its output is a decision packet containing the proposed option, alternatives, supporting evidence, known risks, dissent, and unresolved questions.
- Cross-department disagreements are not settled by a simple majority vote.
- Overwatch is split into two distinct parts:
  - **Overwatch Sentinel:** continuously observes the Head Council and execution. It detects missing expertise, policy or budget boundary risks, unsupported claims, circular discussion, stalled handoffs, duplicated work, and divergence between the approved decision and actual execution. It supplies evidence and may request a safe pause, but it does not choose creative or product direction.
  - **Overwatch Council:** a multi-model, third-party adjudication group. Its members independently review the Head Council's discussion and the Sentinel's evidence from diverse perspectives, then compare judgments and produce a decision with confidence, dissent, conditions, and an escalation reason when judgment is insufficient.
- The Secretary coordinates the chosen decision but does not override an Overwatch Council judgment within its approved authority boundary.
- Overwatch may recommend that the Secretary wake an additional department, but it does not directly spawn production workers.
- After execution, Overwatch compares the decision with the observed outcome and uses replay/synthetic shadow evaluation to propose improvements to the orchestration system.

### 4. Selective adjudication and execute-then-report

- The multi-model Overwatch Council is selective rather than mandatory for every Goal.
- A single Department Head may decide routine, reversible work within that department while Sentinel observes.
- Invoke the Overwatch Council for cross-department goals, material disagreement, high uncertainty, an explicit challenge from Sentinel or a Department Head, or a proposal to create a new department.
- Creating a new department requires an Overwatch Council decision before the department is created or activated. The proposal must explain the missing capability, why an existing department cannot own it, expected duration, cost, and retirement or retention criteria.
- The default operating mode is **execute, then report**: work that is not classified as critical proceeds to completion within existing authority and budget, and the CEO receives an evidence-backed outcome report afterward rather than an approval request beforehand.
- A low-confidence or non-convergent Overwatch Council result is not forced into a decision. It escalates to the CEO with options, evidence, dissent, and the reason for uncertainty.
- Overwatch cannot directly spawn production workers. An approved decision is executed through the Secretary and responsible Department Heads.

### 40. Multi-party final certification

A Goal is reported as successful only when the required evidence authorities have completed their distinct responsibilities:

1. Each executing Department Head accepts its Department's worker outputs and integrated Department commits.
2. Quality validates the integrated Goal revision and deliverables against the launched `task.md` acceptance criteria.
3. Security and Safety & Compliance certify the relevant risk and authority criteria when the Goal requires their participation.
4. Sentinel verifies process integrity, Git lineage, required evidence, budget and authority bounds, and absence of unresolved blocking findings.
5. Sane reports success to the CEO only when all required certifications are present and bound to the same Task Contract and integrated result.

The Overwatch Council adjudicates conflicting certifications or material unresolved uncertainty; it is not a mandatory routine evaluator for every Goal. The CEO need not approve ordinary certified success. Critical push, merge, deployment, release, external publication, or other critical effects retain their separate approval gate.
