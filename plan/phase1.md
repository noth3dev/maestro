# Phase 1 — Technical Foundation and Durable Control Plane

## Outcome

Create the clean-slate Maestro foundation on Prime Agent. At the end of this phase, one Goal can exist as durable state; the app shell and CLI can issue the same commands; authority is default-deny; pause, stop, resume, leases, events, evidence, and restart reconciliation work without any production agent hierarchy yet.

This phase establishes the technical rules every later phase must use. Later phases may add behavior but may not create a second runtime, database, authority path, event truth, or UI-owned state.

## Locked technical stack

### Runtime and repository

- Node.js 24 LTS and strict TypeScript using ES modules.
- npm workspaces. Do not add Nx or Turborepo until measured build time requires it.
- Exact pinned Prime Agent 0.8.x release through its public TypeScript SDK.
- Workspace layout:

```text
apps/control-plane
apps/secretary-office
apps/cli
apps/discord                 # created in Phase 4
packages/domain
packages/contracts
packages/persistence
packages/prime-adapter
packages/authority
packages/evidence
packages/git-ops             # activated in Phase 2
packages/orchestration       # activated in Phase 2
packages/persona             # activated in Phase 2 and expanded in Phase 6
packages/observability
packages/test-harness
```

### Server and contracts

- Fastify 5 for the local command and query API.
- Zod for shared command, event, configuration, and API schemas.
- REST command endpoints for state changes and Server-Sent Events for reconnectable live updates.
- One generated OpenAPI contract and one typed client used by both UI and CLI.
- Every mutation includes `commandId`, actor, expected aggregate version, and Goal/authority context when applicable.
- Repeating a `commandId` returns the first durable result. Version conflicts fail visibly.

### Durable truth

- PostgreSQL 17 as the sole operational source of truth.
- Drizzle ORM with explicit transactions and reviewed migrations.
- Append-only domain events plus current-state projections.
- Transactional outbox for work, notifications, and integration events.
- Lease rows with monotonic fencing tokens. Stale tokens cannot write.
- PostgreSQL `LISTEN/NOTIFY` may reduce latency but polling the durable outbox preserves correctness.
- No Redis, Kafka, or second job system in the first release.

### Prime Agent boundary

- Prime Agent owns model sessions, recursive subagents, parent/child messaging, observation, tool execution, skill loading, model availability, and continual refinement.
- Maestro owns Goal state, organization, assignment policy, authority, budgets, evidence, Department Plans, certification, and reporting.
- Only `packages/prime-adapter` imports Prime Agent SDK types.
- Domain ports expose spawn, resume, prompt, message, observe, cancel, model identity, tool event, usage, and invocation-status behavior.
- Never reimplement provider routing or a Python runner.

### UI and CLI foundation

- Next.js 16, React 19, Tailwind CSS 4, shadcn/ui, and TanStack Query.
- The browser app is the preferred interface; the CLI has operational parity over the same server API.
- The app stores presentation state only. Durable Goal state always returns from the control plane.
- CLI uses Node's built-in `util.parseArgs`, human-readable output, and stable `--json` output.

### Testing and evidence

- Vitest for unit and integration tests.
- fast-check for state-transition, idempotency, and fencing properties.
- Testcontainers with real PostgreSQL.
- Playwright and axe-core beginning with the app shell.
- Pino structured logs and OpenTelemetry traces/metrics.
- Logs are diagnostic; domain events and evidence records are the audit truth.
- Large evidence artifacts use content-addressed storage with SHA-256 and database metadata.

## Domain records to implement

Implement schemas and state machines for:

- installation and operator identity;
- project enrollment reference;
- Goal identity and Goal state;
- Task Contract identity placeholder;
- organizational actor identity placeholder;
- command receipt and idempotency result;
- domain event and durable cursor;
- authority classification, grant, approval, denial, expiry, and revocation;
- lease, fencing token, heartbeat, and successor binding;
- evidence metadata and content hash;
- budget ceiling, reservation, spend record, and remaining amount;
- pause, stop, emergency stop, resume, and recovery incident;
- notification with severity and read state.

Every record has an immutable identifier, creation time, current version, and retention class. Goal-scoped data also has project and Goal identifiers. No record infers authority merely from actor role.

## Required state behavior

### Goal lifecycle foundation

```text
draft -> ready_for_confirmation -> launched -> active
active -> pausing -> paused -> resuming -> active
active/paused -> stopping -> stopped
active/paused -> blocked
blocked -> active | stopped
active -> certifying -> succeeded | failed
any nonterminal -> recovering -> prior safe state | blocked | stopped
```

Not every transition is exposed in this phase, but invalid transitions must already be rejected. A terminal Goal cannot silently return to active.

### Action decision

Every action request is classified as:

- ordinary and allowed inside current Goal authority;
- critical and awaiting exact CEO approval;
- forbidden by policy;
- expired or outside scope;
- ambiguous and therefore denied until clarified.

The decision result names actor, action type, exact target, Goal, expiry, budget effect, reason, and policy version. Enforcement occurs in adapters before Git, process, device, network, provider, or refinement effects.

### Recovery

On startup:

1. Acquire the reconciliation leadership lease.
2. Load nonterminal Goals and latest durable versions.
3. Compare leases with actual Prime Agent sessions, processes, Git state, and later device grants.
4. Fence expired owners before allowing writes.
5. Preserve completed evidence; do not repeat proven work.
6. Mark ambiguous work `no-write/recovery`.
7. Emit a recovery decision and only then resume schedulers.

## Work sequence

1. Scaffold workspaces, strict compiler settings, formatting, test commands, and configuration validation.
2. Prove the pinned Prime Agent SDK can create, prompt, observe, and stop a session; create a direct child; receive an explicit reply; report the actual model; and reconnect or fail closed.
3. Implement pure domain identifiers, errors, state transitions, and action classification.
4. Implement PostgreSQL migrations, repositories, outbox, command receipts, optimistic versions, leases, and fencing.
5. Implement the Fastify command/query API and SSE cursor resume.
6. Implement local operator authentication and separate authority evaluation.
7. Implement app and CLI shells over the same client.
8. Implement evidence storage, structured logs, traces, and correlation identifiers.
9. Implement pause, stop, emergency stop, and restart reconciliation.
10. Build the Phase 1 failure-injection harness.

## Failure and edge cases

- Duplicate command delivery returns the original result.
- Two control-plane processes cannot both own reconciliation.
- A missed database notification is recovered by outbox polling.
- A process killed after commit but before response returns the committed result on retry.
- A stale lease holder receives a hard write rejection.
- Corrupt or unknown event versions stop projection and surface an incident; they are not skipped.
- Database loss blocks execution; agents never continue from memory as if durable state existed.
- Prime Agent unavailability creates a bounded blocked state, not a fake successful session.
- App disconnection does not cancel a launched Goal.
- Emergency stop revokes new work and write authority before waiting for cooperative agent shutdown.

## Tests

1. All invalid Goal transitions fail with typed reasons.
2. Property test repeated commands across crashes and retries.
3. Property test stale fencing tokens against every state-changing repository method.
4. Kill the server at transaction boundaries and confirm exact recovery.
5. Disconnect and reconnect SSE from a stored cursor without loss or duplicated visible events.
6. Execute the same command from app and CLI and confirm identical durable state.
7. Attempt a critical action without approval and prove the adapter is never called.
8. Expire a grant and prove a previously allowed actor is denied.
9. Corrupt one evidence hash and prove certification consumers reject it.
10. Start two reconcilers and prove only one may mutate recovery state.
11. Exercise a live Prime Agent parent/child exchange through the adapter.
12. Verify local configuration contains no copied provider credential.

## Exit gate

Phase 1 passes only when a real PostgreSQL-backed control plane can be killed and restarted while a test Goal is active, reconcile without duplicate transitions, show the same truth in app and CLI, enforce a stale lease rejection, and block an unauthorized critical action. The Prime Agent adapter must complete one live parent/child interaction using only public supported surfaces.

## Requirements preserved in this phase

### 5. Critical-action boundary

Only critical actions stop for CEO approval before execution. Critical actions are:

- Sending a real message, email, publication, or other communication to an external person or audience.
- Deploying to a real service or making a result externally public.
- Pushing, merging, or releasing through a remote repository or shared production branch.
- Permanently deleting data or files.
- Spending money or changing a budget ceiling.
- Changing accounts, permissions, credentials, secrets, authentication, or authority boundaries.
- Connecting a new external service.
- Taking an action with material security, privacy, legal, or compliance consequences.
- Changing an operating policy in a way that is difficult for the CEO to reverse.
- Any action for which Metronome detects a credible risk of unrecoverable harm.

All other work uses execute-then-report within existing permissions and budget. This includes code changes in isolated worktrees, local commits, tests, documentation, refactoring, bounded worker creation, analysis, and replay/synthetic shadow experiments.

When an action is stopped, the CEO report must contain the proposed action, expected benefit, concrete risk, rollback feasibility, Council decision and dissent, and the minimum choice required from the CEO.

### 16. Data-management model — direction under design

Maestro should not treat all data as one shared memory. Data is separated by purpose and authority:

1. **Project source and artifacts** — repositories, files, local commits, reports, screenshots, generated assets, and deliverables. Git or the project's native artifact system remains the source of truth where applicable.
2. **Operational state** — Goals, active Groups and Departments, Head Council membership, worker missions, leases, decisions, approvals, device grants, and current execution status.
3. **Organizational knowledge** — project-specific facts, Department playbooks, reusable procedures, CEO preferences, learned constraints, and prior decision rationales. Every item carries source, scope, owner, confidence, and freshness information.
4. **Evidence and telemetry** — Council transcripts, Metronome findings, command and tool records, evaluation results, cost, token use, latency, failures, rollback evidence, and Encore improvement comparisons. This evidence is append-oriented and cannot be silently rewritten by the candidate it evaluates.
5. **Secrets and authority** — credentials, tokens, device enrollment material, and access grants. These remain in a separate protected store and are referenced by capability, never copied into ordinary prompts, memory, reports, or logs.

Additional principles:

- Project boundaries are private by default. A worker receives only the data needed for its Goal and mission.
- Temporary worker environments are disposable. A worker's scratch data does not automatically become organizational memory.
- Before a worker terminates, its Department Head promotes only the required deliverables, evidence, decisions, and useful lessons into the appropriate durable layer.
- Current state may be updated, but material transitions also produce durable events so recovery and audit do not depend on mutable snapshots alone.
- Data shown to Encore should be sufficient for evaluation while minimizing unrelated content and secret exposure.
- Deletion and retention follow the critical-action boundary and must not be hidden inside routine cleanup.

### 19. Data retention and deletion

Default retention periods are:

- Worker scratch files and detailed execution logs: 30 days after Goal closure.
- Ordinary conversations and full Head Council transcripts: 90 days.
- Cost, evaluation, audit, incident, certification, and rollback evidence: for the lifetime of the project.
- Selected Improvement Digests and material decision records: until explicitly superseded, retired, or removed under policy.
- Secrets: never written to ordinary logs, transcripts, memory, or digests.

Retention is a maximum, not a requirement to preserve noise. Data may be compacted earlier when its evidentiary and operational value has ended, provided required audit links remain intact.

A CEO request to delete a project's records must also trace cross-project lessons derived from that project. Each derived lesson is then removed, re-sourced, or revalidated without the deleted evidence. Deletion remains a critical action and must produce an auditable scope and outcome report.

### 27. Prime Agent is the execution kernel

Maestro is designed to run **on top of Prime Agent**, not to replace Prime Agent with a second independent agent runtime.

Responsibility boundary:

- **Maestro owns:** CEO Goals, Secretary workflow, Groups and Departments, Head Council policy, selective activation, Department Context Packs, data and authority policy, budget and critical-action gates, organizational UI, outcome reporting, and Encore improvement objectives.
- **Prime Agent owns:** model execution, recursive subagent spawning, parent/child messaging, observation, task environments, tool execution, skill and plugin availability, model selection surfaces, and the continual harness used by refinement.

Runtime mapping:

- Waking a Department Head means spawning or resuming a Prime Agent subagent from that Head's durable organizational identity and harness specification.
- A Head spawns Scout or Execution Workers as its direct Prime Agent children. This preserves the intended reporting hierarchy in the runtime itself.
- Sleeping a Department Head terminates active execution while preserving the Head's approved identity, Department Context Pack, traits, and durable organizational knowledge.
- The Secretary is the root organizational coordinator. Head Council communication uses bounded agent messaging and produces a shared decision packet.
- Metronome observes the Prime Agent family, event stream, costs, tool use, authority grants, and Maestro Goal state without becoming a worker's execution parent.
- The multi-model Encore Council uses separate Prime Agent subagents and, when available and approved, distinct model selectors to create genuinely independent judgments.

### 34. Automatic recovery within Goal bounds

- Department Heads and the Head Council automatically retry, replace, or replan failed work within the Goal's existing cost, time, authority, and safety bounds.
- A retry requires new information, a changed hypothesis, a changed method, or a justified model, skill, environment, or worker change. Blind repetition of the same failed attempt is prohibited.
- Failed worker branch state, evidence, commands, and partial deliverables are preserved until reviewed. Useful partial commits may be retained and integrated through normal review.
- Other independent Department work continues when safe; a single worker or Department failure does not automatically cancel the Goal.
- Missing expertise may wake another existing Department under the agreed rule. Creating a new Department still requires Encore Council approval.
- Process or environment recovery resumes from durable Goal state and recorded Git revisions, verifies leases and enrolled-device authority, and prevents duplicate active workers before writing resumes.
- Noncritical unrecoverable failure does not interrupt the CEO mid-run. The system exhausts useful bounded alternatives, then reports the failure, attempts, evidence, preserved results, and next options.
- Critical risk follows the existing immediate CEO approval or safe-stop boundary.
- Failures, recoveries, avoided retries, and exhausted alternatives produce Improvement Digests.

### 49. Pause, stop, emergency stop, and resume

- **Pause:** stops new workers and new work, brings active commands to a safe pause point, suspends enrolled-device write authority, and preserves branches, worktrees, environments, context, and resumable state.
- **Resume:** revalidates the Task Contract, base and active Git revisions, leases, environment health, device authority, budgets, and worker identity before work continues. It does not blindly restart stale processes.
- **Stop:** cancels workers, revokes active external and device grants, closes Council execution, preserves incomplete branches, commits, evidence, and useful results, and produces a Concertmaster stop report with completed work, unfinished work, spend, side effects, and resume options. Stop does not delete results automatically.
- **Emergency stop:** blocks execution immediately where possible, revokes all write authority, prevents automatic resume, and asks Discord and Metronome to verify remaining processes and observed side effects. Any already completed external effect becomes an incident record.
- Deleting preserved results or evidence remains a separate critical action.

### 52. Durable restart and safe resume

- A restart restores Concertmaster, launched Task Contracts, active Goals, Council decisions, participating Groups and Departments, budgets, authority grants, certification state, and the radial-tree view from durable records.
- Recovery reconciles durable state with actual Prime Agent children, Git branches and worktrees, commits, environments, commands or processes, leases, device grants, and evidence before any write resumes.
- Work with valid completion evidence is not repeated.
- Ambiguous or stale workers enter a no-write recovery state. The system checks whether their mission is still required and prevents duplicate execution before resuming or creating a successor identity.
- Sleeping Heads restore durable identity, persona, Context Pack, and organizational memory without restoring an unnecessary execution process.
- Temporary workers are not revived merely because they existed before the restart. A still-required mission resumes through an auditable successor or recovered child binding.
- External and enrolled-device authority is revalidated and does not survive by assumption.
- The radial tree reflects reconciled reality, including recovery, orphaned, paused, or superseded nodes, rather than replaying a stale visual snapshot.

### 55. Continuous control plane with an optional app client

- Maestro's control plane operates continuously and is not tied to the app window or an interactive chat session.
- Closing the app does not stop launched Goals, Concertmaster state, Encore observation, Discord monitoring, durable leases, or safe remote and virtual-environment work.
- Department Heads and workers remain selectively activated and do not run merely because the control plane is online.
- Work requiring a disconnected or powered-off enrolled device pauses at the affected boundary; independent work in available environments may continue.
- Reopening the app restores current Concertmaster conversation, Goal portfolio, radial tree, incidents, Git, budget, evidence, and certification state from reconciled durable truth.
- Severe incidents use the approved out-of-band Discord channel. Noncritical notifications may be grouped during CEO-configured quiet hours.

### 57. Direct replacement with a Prime Agent-native Maestro

The target architecture may replace the current standalone Maestro execution model and existing Web UI rather than preserving backward compatibility with their internal design.

- Prime Agent becomes the native execution kernel from the beginning of the replacement.
- The new Secretary Office, Group and Department hierarchy, recursive Head and worker spawning, skill and plugin assignment, continual-harness refinement, Encore organization, Discord integration, Git hierarchy, data model, and radial app are designed as one coherent system.
- Existing `runner`, `spawner`, provider-routing, flat agent assumptions, and legacy Web UI interfaces are not compatibility constraints and may be retired when the replacement clears its acceptance gates.
- Verified safety properties remain requirements even when their old implementation is discarded: default-deny authority, bounded budgets, critical-action approval, immutable execution identity, lease and fencing protection, Git isolation, external receipt or evidence integrity, crash recovery, auditability, and shadow-first self-improvement.
- Replacement development still occurs in isolated Git branches and worktrees with a reversible cutover. “Direct replacement” means no obligation to preserve the old architecture, not destructive editing without evidence or rollback.
- Old code is removed only after the new system passes representative live behavior, recovery, security, data, and UI acceptance scenarios and the retained data decision below is satisfied.

### 58. Clean-slate replacement state

- The replacement imports no legacy Maestro operational state, active Goals, workers, leases, authority grants, UI state, routing state, telemetry, Council transcripts, or unverified memory.
- The new system starts with an empty operational database and no implied active execution.
- The approved hierarchical design, Concertmaster identity and trait seed, organizational taxonomy, safety boundaries, and app direction are new-system requirements, not migrated runtime records.
- Existing project Git repositories remain independent source systems and may be enrolled into the new Maestro as fresh projects. They are not deleted as part of clearing Maestro state.
- Historical legacy data is not required for new-system behavior or evaluation. Removal at cutover follows the agreed critical deletion and reversible Git or backup process, but no compatibility or import path is required.
