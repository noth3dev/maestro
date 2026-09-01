# Phase 8 — Full-System Hardening and Release Certification

## Outcome

Prove the complete clean-slate Maestro under sustained operation, adversarial failure, security review, data lifecycle checks, recovery, and all representative live scenarios. Release is blocked by any failed required scenario or open critical finding.

## Purpose

Define Maestro as a selective, hierarchical organization rather than a flat roster of peer agents.
Department Heads act like functional directors: they discuss cross-domain work, spawn bounded workers, review their departments' results, and return to standby when the goal is complete. Overwatch remains outside the command chain and improves the orchestration system by observing it end to end.

## Release candidate freeze

Before certification:

- freeze contract, event, database, authority-policy, and evidence-schema versions;
- pin Node, PostgreSQL, Prime Agent, browser, and package versions;
- record configuration and migration identity;
- disable experimental improvement classes not explicitly part of certification;
- create an additive recovery checkpoint and database export;
- ensure every adaptive persona has a certified predecessor;
- publish the exact test scenario identities and protected metrics;
- permit only defect fixes that rerun affected and full gates.

## Hardening workstreams

### Security and authority

- Threat-model prompt injection, malicious repository content, compromised worker, stale session, forged Firefly signal, stolen device token, approval replay, evidence tampering, path escape, shell injection, and provider credential leakage.
- Verify every effectful adapter enforces authority and fencing below prompts.
- Verify critical approvals bind exact action, target, artifact, Goal, expiry, and policy version.
- Verify remote push, deployment, external send, payment, deletion, permission change, and provider enrollment fail closed.
- Verify secrets never enter prompts, logs, evidence, Git, or browser payloads.

### Reliability and recovery

Inject:

- control-plane termination at every workflow boundary;
- PostgreSQL reconnect and missed notification;
- Prime Agent session loss or unavailable model;
- worker timeout, cancellation, late result, and duplicate reply;
- partial Git operation and merge conflict;
- environment or device disconnect;
- Firefly outage, duplicate signal, stale signal, and silence;
- evaluator crash during Council, Quality, and persona rollout;
- app disconnect and stale command;
- disk pressure and evidence write failure.

The system must reconcile to one explainable durable state without duplicate effects.

### Data lifecycle and privacy

- Verify project-private context isolation.
- Verify data classification, retention, expiry, export, and deletion behavior.
- Verify deleting evidence invalidates or reevaluates derived knowledge and persona claims.
- Verify content-addressed artifacts and hashes.
- Verify audit records preserve truth without retaining prohibited private content.
- Verify no legacy operational state or hidden migration path exists.

### Cost and performance

Measure:

- Goal command and event latency;
- SSE recovery latency;
- scheduler and reconciliation time;
- Head/worker activation latency;
- context size by role;
- model and skill routing cost;
- Quality and Council overhead;
- radial graph behavior under large portfolios;
- Firefly detection and delivery time;
- PostgreSQL query and storage growth;
- idle improvement budget.

Quality, safety, authority, and evidence remain hard floors. Performance optimization cannot remove them.

### Accessibility and operator recovery

- Complete WCAG 2.2 AA audit.
- Keyboard and screen-reader walkthrough of every critical flow.
- Emergency-stop and recovery drills from app and CLI.
- Operator documentation for startup, backup, restore, model outage, database failure, stale lease, device revocation, Firefly silence, and failed rollout.
- Sane documentation stewardship checks canonical behavior against generated documentation and detects drift.

### Long-running operation

Run a soak period with:

- multiple concurrent Goals;
- scheduled idle improvement evaluation;
- app disconnect/reconnect;
- provider rotation and controlled unavailability;
- periodic restart;
- Firefly probes;
- persona evidence collection without uncontrolled drift;
- resource, cost, and storage monitoring.

No Head or worker remains awake without an active obligation. No grant, lease, environment, or device access survives beyond its scope.

## Full acceptance execution

Run every representative scenario for real wherever safe. Use disposable repositories, environments, endpoints, and test credentials. For a truly external or irreversible final effect, verify through the last safe preview and exact approval boundary; do not execute it without separate CEO permission.

For each scenario record:

- preconditions and fixture identity;
- Goal and Task Contract version;
- actual actors, models, skills, tools, and costs;
- injected failures;
- durable events and evidence;
- expected and observed behavior;
- certifications, dissent, and limitations;
- cleanup and retained artifacts.

## Release decision

Release recommendation requires:

- every phase exit gate passing on the frozen candidate;
- all representative live scenarios passing;
- zero open critical security, authority, correctness, recovery, privacy, or data-integrity finding;
- all noncritical findings assigned an owner, consequence, and deadline;
- demonstrated backup and restore;
- demonstrated adaptive-persona rollback;
- demonstrated critical-action denial and exact approval binding;
- complete documentation and evidence bundle;
- CEO-visible Council confidence and dissent.

There is no legacy cutover. Release means enabling the new clean-slate Maestro for its approved operating scope.

## Rollback and failed release

If a required scenario fails:

1. Stop release progression.
2. Preserve evidence and candidate version.
3. Disable new external or improvement authority.
4. Return active test Goals to safe stopped or paused state.
5. Repair the smallest responsible component.
6. Rerun the failed scenario, its phase gate, and the full regression gate.
7. Never waive a critical failure to meet schedule.

## Tests and audits

1. Full state-transition and authority branch coverage.
2. Property-based idempotency, fencing, budget, and persona-bound tests.
3. Database migration forward, backup, restore, and corrupt-input tests.
4. Prime Agent compatibility matrix and live parent/child behavior.
5. Git isolation, conflict, cleanup, and remote denial.
6. Device enrollment, expiry, revocation, and replay resistance.
7. Firefly independence, authentication, deduplication, and silence.
8. Concurrent Goal contamination and capacity tests.
9. Council independence, same-model labeling, and non-convergence.
10. Quality defect-seeding and certification invalidation.
11. Improvement evidence, refinement scope, regression rollback, and diversity preservation.
12. App/CLI parity, reconnection, accessibility, and large radial graph.
13. Data retention, deletion propagation, and project privacy.
14. Soak, load, cost, and fault-injection suites.
15. Human-readable reconstruction of one final evidence bundle.

## Exit gate

All required scenarios and audits pass on one frozen candidate. Backup and restore are demonstrated. No critical finding remains. The final report names exact supported scope, disabled capabilities, known limitations, costs, confidence, and dissent. Only then may the CEO separately authorize any real remote push, deployment, publication, external connection, or other critical release effect.

## Complete representative requirements

### 59. Replacement acceptance scenarios

The Prime Agent-native replacement is ready for cutover only when all ten representative live scenarios pass end to end:

1. **Overture:** Sane activates only the needed Overture Crew roles, incorporates project context, external evidence or a design mock when required, produces one coherent `task.md`, and obtains the single CEO launch confirmation.
2. **Hierarchical execution:** only relevant Heads wake; independent briefs, Head Council, Scout evidence, worker spawning, hierarchical Git integration, independent Quality validation, and Sane reporting all complete.
3. **Head-to-Head activation:** a Head directly calls another existing Head during a Goal; context, Council membership and budget update without duplicate activation.
4. **Environment and enrolled device:** a worker safely uses a virtual environment, project CLI and browser or device access inside scope while a critical out-of-scope effect is blocked.
5. **Restart recovery:** Maestro or Prime Agent restarts mid-Goal and reconciles durable state without duplicate workers, stale authority, lost accepted work, or false success.
6. **Firefly incident:** external detection wakes the correct Heads in triage mode, produces an Incident Task Contract, drives bounded remediation, and reaches independent certification.
7. **Overwatch improvement:** milestone evidence becomes a curated Digest, an improvement candidate is shadow-evaluated, the multi-model Council judges it, and an allowed `refine` change applies or rolls back from measured evidence.
8. **Portfolio Council:** competing Goals are prioritized by Overwatch and affected Heads, with safe pause, resource reallocation, and resume.
9. **Critical gate:** remote push or external sending remains blocked until the exact CEO approval and cannot expand beyond the approved action.
10. **Radial app:** Sane is central; Goal, Group, Head, worker, Git, context, Overwatch and incident lineage expand radially; interactive node actions, avatars, persona, diff, pause and evidence remain legible in the approved restrained shadcn direction.

Passing requires exercising real behavior, not only parsing, unit tests, static screenshots, or mocked success. Failure of any required scenario blocks cutover.

## Design closure

The organization, authority, execution, data, refinement, external monitoring, Git, UI, recovery, and acceptance behavior are fully allocated across the eight delivery phases. Phase 1–3 form the first usable release; Phases 4–8 expand and certify the complete system. Application implementation still requires a separate explicit green light after review of these phase files.

## Safety Baseline

Existing safety constraints remain in force unless explicitly changed during this design interview:

- Initial autonomous improvement is replay/synthetic and shadow-only.
- No automatic changes to permissions, secrets, providers, budgets, network access, external sending, deployment, push, deletion, or policy.
- Connected services require explicit approval and least privilege.
- Production-impacting changes require human approval.
