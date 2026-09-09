# Phase 2 — Secretary Office Core and Hierarchical Goal Execution

> **Current status (2026-09-08):** The hierarchical execution building blocks and real PostgreSQL/native Model Gateway evidence exist, including native Head and Worker admissions. Plan 2 S6 is merged and verified; Phase 2 now proceeds to §S7 documentation handoff. The later Plan 3 production host-tool contract remains separate: workers remain text/evidence-only until the IPython local host-tool surface, authority enforcement, approval hierarchy, and live acceptance scenario are implemented and independently reviewed. Historical code-level completion markers remain provenance, not current acceptance. Prime Agent is not part of the current implementation.


## Outcome

Turn the durable foundation into the execution hierarchy for one local software Goal. Concertmaster conducts intake, the Overture Crew produces one Task Contract, the CEO confirms once, only required Heads wake, each Head writes a Department Plan, and bounded native workers produce text/evidence under Mission Bundles. The explicit Control Plane Git service can create isolated branches/worktrees and integrate revisions; worker-side file/tool effects remain pending the approved production host-tool contract.

Encore certification is completed in Phase 3, so Phase 2 cannot yet report a Goal as fully successful.

## Organization implemented

Permanent Groups and Departments:

```text
Product Group
  Product Department
  Design Department
Tech Group
  Engineering Department
  Security Department
  Infrastructure Department
Intelligence Group
  Research Department
  Data & Analysis Department
Assurance Group
  Quality Department
  Safety & Compliance Department
Operations Group
  Operations Department
```

Groups are containers, not agents. Concertmaster convenes Goal-scoped Department Heads directly. Sleeping Departments have durable identity and knowledge but no running session and receive no Goal context.

## Concertmaster and Task Contract flow

1. CEO states an outcome in plain language through app or CLI.
2. Concertmaster creates a draft Goal and activates the smallest required Overture Crew roles from the six-role candidate pool.
3. Architecture Analyst reads authorized project evidence, codebase structure, dependencies, and system topology.
4. External Research Scout activates only when current outside evidence is needed.
5. Conversation Lead and Task Editor identify outcomes, non-goals, priorities, edge cases, and acceptance behavior; Security Evaluator records material risk, budget, and critical-action boundaries.
6. Design & Mock Specialist creates disposable previews only when seeing an option is necessary.
7. Task Editor maintains one versioned `task.md`.
8. Concertmaster presents the complete contract, expected effects, initial budget range, and authority boundary.
9. CEO gives one explicit launch confirmation bound to the exact content identity.
10. The Goal launches; ordinary in-scope work proceeds without repeated approvals.
11. Material intent change creates a visible amendment and new content identity.

Nothing may spawn an execution worker before step 9.

## Task Contract required fields

- desired outcome and user-visible behavior;
- success criteria and required live evidence;
- scope and explicit non-goals;
- priorities and acceptable tradeoffs;
- constraints and known edge cases;
- project, repository, immutable base revision, and data boundary;
- evidence and approved preview references;
- expected Groups and Departments;
- critical-action expectations and forbidden effects;
- environment and external-service assumptions;
- budget ceiling, reporting expectations, and stopping conditions;
- version, decision history, content hash, and launch state.

## Head activation and deliberation

### Activation

Concertmaster activates the smallest likely set. An active Head may request another existing Head by supplying Goal, reason, evidence, requested contribution, urgency, context scope, and budget effect. The control plane prevents duplicate and cyclic activation. Each Head participation and native runtime session binding is keyed by `(HeadRoleId, GoalId)`; a persistent Head never receives two Goals in one runtime context. New Departments remain outside this phase and require later Council approval.

### Independent briefs

Before shared discussion, every activated Head writes an independent brief stating:

- interpretation of the Goal;
- Department contribution and non-goals;
- assumptions and evidence gaps;
- risks and dependencies;
- proposed validation;
- expected workers, cost, and time;
- objections to likely alternatives.

Briefs are sealed until all required Heads submit or time out, preventing early anchoring.

### Head Council

The Council shares briefs, identifies agreement and conflict, requests bounded evidence, and records a decision packet. It does not settle material disagreement by simple majority. Discussion stops when issues are resolved or two rounds add no new evidence. Qualifying unresolved conflict routes to Phase 3 Council behavior.

## Department Plans

After the Goal decision and before execution workers, each active Head owns a versioned Department Plan containing:

- Department contribution and non-goals;
- plan items with stable identifiers;
- dependencies and required handoffs;
- Scout questions and evidence needs;
- Execution worker assignments;
- sequential and safe parallel work;
- budget, time, retry, and worker ceilings;
- repository, branch, worktree, and integration path;
- risks, safe pause points, and escalation triggers;
- evidence and Department validation criteria.

The Head Council reconciles overlap, gaps, and contradictions. Concertmaster records the agreed set without silently rewriting domain judgment. Workers bind to an active plan version and link every result to satisfied plan items.

A Head may revise its plan when evidence changes. The revision records cause, affected items, workers, cost, schedule, and cross-department effect. In-scope changes proceed automatically. Cross-department changes return to the Head Council. Goal, budget-ceiling, authority, or critical-effect changes return to the CEO boundary.

## Worker authority and hierarchy

- Only a Department Head may create ordinary workers.
- A worker that needs help requests it from its Head; it cannot silently create a child hierarchy.
- A Head may designate a bounded team-lead worker only for a large mission. The grant fixes maximum helpers, cost, duration, task scope, reporting, and revocation.
- Helpers created under that exception still belong to the Department Plan and remain visible to the Head and Metronome.
- Unbounded recursive spawning is forbidden.
- Scout workers are read-only by default.
- Execution workers receive isolated worktrees and uniquely owned branches.
- Workers can collaborate directly only through bounded, recorded channels. Their Heads remain accountable.

## Ten-axis persona baseline

Every persistent role and temporary worker has exactly these normalized axes:

1. `agreeableness`
2. `extraversion`
3. `imagination`
4. `realism`
5. `conscientiousness`
6. `caution`
7. `initiative`
8. `empathy`
9. `adaptability`
10. `sociability`

Concertmaster starts at:

```text
agreeableness      0.70
extraversion       0.75
imagination        0.65
realism            0.90
conscientiousness  0.95
caution            0.90
initiative         0.92
empathy            0.85
adaptability       0.88
sociability        0.82
```

Persistent Heads, Metronome, and Council personas receive reviewed duty-derived baselines. Temporary workers receive a mission profile derived from Department style, Head choice, task ambiguity, risk, collaboration demand, and evidence burden. Worker overlays expire with the mission.

Traits influence style, exploration, initiative, collaboration, challenge, escalation tendency, and adaptation. They never grant permission, change budget, override evidence, weaken safety, or decide truth. Professional duty wins over personality. Evidence collection for later adaptation starts now, while live automatic trait updates remain disabled until Phase 6.

## Mission assignment bundle

Every Head and worker receives:

- stable identity and current ten-axis profile;
- Goal Brief and smallest necessary context;
- active Department Plan or bounded mission item;
- approved model or model set;
- only required skills and plugins;
- allowed tools, paths, and environment;
- authority, external-service, and data boundaries;
- cost, time, retry, and worker limits;
- deliverable, evidence, validation, parent, and termination conditions.

Installed capability is not automatically assigned capability. Missing capability becomes a Head request or explicit proposal.

## Model and capability routing

- Meet quality and safety first; then choose the lowest-cost demonstrated model.
- Concertmaster and Heads use models strong enough for continuity, planning, delegation, and synthesis.
- Scouts prefer lower-cost retrieval models and escalate on conflict or complexity.
- Workers use the smallest model proven for that mission rather than inheriting the Head model.
- Skills are selected per mission to reduce context and authority surface.
- Record actual provider, model, skill, plugin, cost, latency, and result for later routing improvement.

## Production host-tool and IPython contract

Phase 2 now owns the first executable host-tool surface. It follows Prime Agent's runtime shape without importing Prime Agent: the model receives one persistent `ipython` tool, Python code runs in a Goal-bound session, and reusable project capabilities are ordinary Python-backed skills. Direct `ToolDefinition` registrations remain for stable schemas and authority gates, not as a second general execution loop.

### Scope

- Local project files, local Git, project tests, local shell commands, and local environment changes are in scope.
- The default session is limited to the Goal worktree and declared temporary directories.
- The user may activate full local access for the session. The user chooses whether full access retains Head/Encore approvals or skips intermediate approvals; critical and forbidden boundaries remain explicit.
- Browser, device, external API, deployment, remote push, payment, and other external capabilities remain Phase 4 or later and must be individually activated.

### Approval hierarchy

Every IPython code block is classified as one unit; if it contains multiple effects, the highest required level applies and no partial execution occurs:

1. **Independent execution:** in-scope ordinary work covered by the active Mission Bundle.
2. **Department Head approval:** the active Goal-scoped Department Head authorizes work within its Department boundary.
3. **Encore Council approval:** material cross-Department impact, unresolved Head disagreement, high uncertainty, or a request to widen bounded improvement authority.
4. **User approval:** critical, external, irreversible, authority/budget, or otherwise ambiguous work. Encore disagreement escalates here.

Approval is exact and bounded to the code/action identity, target, Goal, expiry, budget, and selected repetition scope. The user may choose one execution, bounded count/time/budget, or session duration. Rejection proposes a safer alternative; it never silently downgrades the request. Every decision, interruption, result, and failure is durable evidence.

### Tool lifecycle

An agent may create a temporary Python function in the current session. It is not a durable capability until the user explicitly saves it as a project skill. Automatic skill promotion and cross-project sharing are outside the Phase 2 implementation; Phase 6 may consume milestone evidence later through its Improvement Digest boundary.

### Implementation sequence and ownership

The detailed test-first execution plan is canonical in `roadmap/act-1-foundation/active/operations/task_plan.md` under **Phase 1A–1D host-tool execution plan**. Phase 2 owns the persistent session, host-request protocol, local authority-backed effects, approval/repetition/full-access state, audit/stop behavior, and the live Goal acceptance scenario. Phase 1 owns only the minimum registry/runtime boundary and strict read-only gate.

Implementation is deliberately incremental:

1. Register `ipython` with a typed schema and prove grant filtering, session serialization, identity propagation, and fail-closed lifecycle behavior.
2. Add the Node-owned JSON-lines bridge and a constrained Python bootstrap. Read-only file/Git evidence is the only initial host allowlist. The current implementation has the versioned bridge, production-owned detached process channel, parent-identity watchdog, real-child-tested constrained Python bootstrap, read-only host router, and authority-backed workspace-file/Git adapters; durable orphan evidence, local effects/approvals, and live worker acceptance remain open.
3. Add whole-block classification, exact approval scope, repetition limits, two full-access modes, durable audit, idempotency, interruption, stale-fence, and forbidden-action enforcement.
4. Compose the registry through Control Plane → native kernel → worker Mission Bundle, then verify the real PostgreSQL/API/Gateway path and independent review.

No Phase 2 acceptance is claimed from a unit-only run. Historical completion markers remain provenance until this live boundary is proven.

## Git execution model

1. Record repository and immutable base revision in the Task Contract.
2. Create a Goal integration branch.
3. Create one Department branch for each writing Department.
4. Create a uniquely owned worktree and worker branch for each Execution worker.
5. Worker commits contain mission-only changes and link Goal, plan item, evidence, and tests.
6. Head reviews and integrates accepted worker commits into the Department branch.
7. Cross-department integration occurs on the Goal branch after interface checks.
8. Quality later validates the integrated Goal revision.
9. Remote push, shared merge, history rewriting, release, and deployment remain blocked critical actions.
10. Cleanup occurs only after accepted lineage or rejected outcome is durable.

Use `child_process.spawn` with argument arrays. No shell-interpolated Git commands. Ownership and fencing checks precede every mutation.

## Budget behavior

Encore policy produces an initial range using task uncertainty, historical evidence when available, model cost, expected validation, and recovery reserve. Concertmaster and the Head Council may reallocate inside the CEO ceiling. Each Head allocates its Department budget. Quality and recovery floors cannot be reduced to make execution appear affordable. Increasing the total ceiling requires CEO approval.

## Work sequence

1. Implement permanent organization and durable role/persona records.
2. Implement Concertmaster session binding and Overture Crew selection.
3. Implement Task Contract editor, content identity, amendment, and confirmation.
4. Implement Head activation, sleep/resume, duplicate prevention, and bounded Head-to-Head calls.
5. Implement the reusable sealed-submission primitive, then the Head Council consumer: immutable frozen participant/session/contract/evidence snapshot; idempotent sealed submission; deadline/absence policy; reveal; append-only events/audit; evidence-tagged complete discussion rounds; novelty and stopping; and a non-executable escalation outcome distinct from an executable resolved decision.
6. Implement Department Plan schema, reconciliation, revisions, and worker linkage only after a resolved Council packet bound to the exact frozen contract/evidence snapshot is durable.
7. Implement mission bundles and least-privilege capability selection.
7a. Implement the persistent IPython host-tool contract for local files, Git, tests, shell, and local environment changes; register it explicitly, bind it to Goal scope, enforce the four-level approval hierarchy, and keep external capabilities disabled by default.
8. Implement Scout and Execution worker lifecycles through the native `ExecutionKernelPort` hierarchy.
9. Implement worker request-for-help and bounded team-lead exception.
10. Implement Git repository, branch, worktree, commit, integration, diff, and cleanup evidence.
11. Implement budget reservations and milestone forecasts.
12. Run a real local Goal through integrated change, stopping before final certification.

## Failure and edge cases

- CEO edits the draft during confirmation: invalidate the old content identity.
- A Head awakens twice: return the current participation, not a duplicate session.
- Two Heads request each other cyclically: reject the second activation edge and surface evidence.
- One Head misses the brief deadline: record absence and decide whether evidence is sufficient or escalation is required.
- Worker returns after its plan version is superseded: quarantine result until Head reviews; no automatic integration.
- Worker asks for a helper: only Head can grant; denial does not expand mission scope.
- Worktree contains unrelated changes: reject commit integration.
- Merge conflict: create explicit owned integration work; do not let an unrelated worker resolve it opportunistically.
- Budget forecast exceeds ceiling: reduce scope only through Goal amendment or pause before overspend.
- Model unavailable: route only to a demonstrated substitute and record the change; otherwise block the mission.
- Sleeping Head must not retain active Goal transcript in a global context.

## Tests

1. Task Contract cannot launch without exact confirmation.
2. Edited contract invalidates prior confirmation.
3. Only selected Departments receive Goal context.
4. Duplicate and cyclic Head activation are prevented.
5. Independent briefs remain hidden until the reveal point.
6. Two empty discussion rounds trigger the stopping rule.
7. Every active Head creates a Department Plan before execution workers.
8. Worker results cannot satisfy an absent or superseded plan item.
9. Ordinary worker cannot spawn another worker.
10. Bounded lead cannot exceed helper, cost, time, or scope ceiling.
11. Mission persona values remain in `[0,1]` and expire correctly.
12. Skills not in the assignment bundle are unavailable to the mission.
13. Scout cannot write without a specific writing assignment.
14. Worker cannot edit another worktree or branch.
15. Remote push is denied before Git invocation.
16. Late worker cannot overwrite integrated work.
17. An IPython session executes an in-scope local project read/edit/test flow through the registered host tool and existing adapters.
18. A mixed-risk IPython block is held at its highest approval level and never partially executes.
19. Department Head, Encore, and user approval paths bind exact action scope, expiry, repetition budget, and audit evidence; disagreement and ambiguity escalate to the user.
20. Full local access has both approval-retaining and intermediate-approval-skip modes, each explicitly selected by the user per session; forbidden actions remain denied.
21. Real worker completes and tests a disposable local project change.
22. App and CLI display the same Task Contract, hierarchy, plan versions, budget, and Git state.

## Exit gate

A plain-language request must become one confirmed Task Contract. Only the necessary Heads activate, write independent briefs, deliberate, and own versioned Department Plans. Scouts gather evidence; the Phase 2 IPython host tool enables bounded local file, Git, test, shell, and local-environment work only after the explicit contract and approval checks. External capabilities remain separately activated in Phase 4. No worker can create hidden workers, exceed authority, write another branch, partially execute a mixed-risk block, or push remotely. The Goal remains `awaiting certification` until Phase 3.

## Requirements preserved in this phase

### 1. Organization shape

- The CEO communicates primarily through the Secretary.
- The Secretary acts as Chief of Staff and coordinates Department Heads.
- Department Heads own distinct functional areas and collaborate with other Heads when a goal crosses domains.
- Workers are temporary, task-scoped agents spawned by a Department Head.
- Workers report to their spawning Head rather than joining a flat global agent pool.
- Departments that are not needed remain asleep or on standby.
- Encore observes the whole orchestration system from outside the execution hierarchy.

### 2. Selective department activation

Use a two-stage activation model:

1. Concertmaster initially wakes the smallest set of Departments likely to be required.
2. During discussion or execution, an awakened Department Head may directly wake another existing Department Head when missing expertise, a new dependency, or an independent challenge is discovered.
3. The calling Head supplies a bounded activation brief with the Goal, reason, evidence, requested contribution, urgency, context scope, and expected budget impact.
4. Concertmaster records the activation, prevents duplicates, updates Council membership and context routing, and coordinates budget or schedule effects, but does not act as a routine approval gate.
5. Metronome detects cyclic, duplicative, unjustified, or runaway activation. Creating a new Department still requires Encore Council approval.

**Reason:** This avoids waking every Department for every Goal, does not require Concertmaster to predict every dependency at intake time, and lets domain experts bring in the expertise they discover they need without administrative delay.

### 6. Default permanent departments

Start with five permanent departments:

1. **Product & Design** — requirements, prioritization, user experience, and interface design.
2. **Engineering** — frontend, backend, data, infrastructure, and implementation workers.
3. **Research** — technical investigation, market and competitor research, source verification, and evidence gathering.
4. **Quality & Safety** — independent testing, review, security, safety, and acceptance validation. This department remains organizationally separate from implementation.
5. **Operations** — Goal operations, incidents, state, cost, Git/worktree coordination, and operational readiness.

The Secretary is the CEO's Chief of Staff, not a department. Encore is an independent oversight layer, not a department. A recurring capability may become a new permanent department only after Encore Council approval.

### 7. Permanent Groups and Departments — corrected interpretation

The term **Group** means a permanent organizational domain, not a temporary Goal task force. A Group contains related Departments. For example:

- **Tech Group**
  - Engineering Department
  - Security Department
  - Infrastructure Department

Departments retain their own Department Heads, standards, memory, and worker pools. For each Goal, the Secretary selects only the relevant Department Heads from the required Groups. Those selected Heads form the Goal-scoped Head Council. Unneeded Groups and Departments remain asleep and receive no Goal context.

Each selected Department Head may spawn bounded workers for its assigned contribution. Workers report to that Department Head. The Head Council ends when the Goal closes, but the Groups and Departments remain permanent organizational structures.

This clarification reopens the earlier five-department list for regrouping: the final Group and Department taxonomy must be defined before implementation.

### 8. Groups are organizational containers

- A Group is a permanent organizational container, not an agent by default.
- Groups do not have persistent Group Head agents in the initial organization.
- The Secretary directly convenes the relevant Department Heads across Groups for each Goal.
- This avoids an extra reporting layer, unnecessary deliberation, and token cost.
- A Group Head may be proposed later only when the Group has grown enough that repeated coordination failures demonstrate a real need. Creating that role requires Encore Council approval under the same capability-expansion rule used for new departments.

### 9. Initial Group and Department taxonomy

The initial permanent organization is:

- **Product Group**
  - Product Department — decides what should be built and why.
  - Design Department — owns user experience and interface design.
- **Tech Group**
  - Engineering Department — owns implementation.
  - Security Department — owns adversarial review, permissions, secrets, and vulnerabilities.
  - Infrastructure Department — owns execution environments, deployment readiness, and performance foundations.
- **Intelligence Group**
  - Research Department — owns external evidence and technical investigation.
  - Data & Analysis Department — owns internal measurement, comparison, and quantitative analysis.
- **Assurance Group**
  - Quality Department — owns independent requirements validation and testing.
  - Safety & Compliance Department — owns operating boundaries and critical-risk assessment.
- **Operations Group**
  - Operations Department — owns Goal state, cost, incidents, and Git/worktree operations.

All departments remain asleep unless selected for a Goal. The number of permanent departments does not imply that their agents run continuously.

### 12. Department Head worker authority

- A Department Head may autonomously spawn the bounded workers needed for its assigned contribution without per-worker CEO approval.
- Independent work may run in parallel. Work that shares mutable scope must be sequenced or explicitly coordinated.
- Every worker starts with one named mission, completion criteria, bounded scope, expected cost, and a reporting Department Head.
- Workers do not spawn other workers.
- Duplicate workers, overlapping ownership, and workers without a concrete deliverable are prohibited.
- A worker terminates when its mission completes, becomes unnecessary, exceeds its bounds, or cannot make useful progress.
- Material expansion beyond the Goal's expected scope or budget returns to the Head Council for review.
- Metronome monitors worker multiplication, duplicated effort, idle time, cost, and scope drift and may request a safe pause.

### 15. Bounded cross-department worker collaboration

- Workers normally communicate through their own Department Heads and the Goal-scoped Head Council.
- Direct collaboration between workers from different Departments is allowed only when the work requires close coordination, such as an interface contract, integration, or shared investigation.
- Both Department Heads establish the collaboration purpose, scope, expected output, and duration.
- The channel is bound to one Goal and closes automatically when the collaboration completes or the Goal ends.
- Messages, transferred artifacts, and decisions remain auditable.
- Workers cannot use a direct channel to expand scope, create workers, change authority, or make a cross-department policy decision.
- Unresolved disagreement returns to the responsible Department Heads.

### 21. Scout and Execution worker phases

- A Department Head may spawn a bounded **Scout Worker** while the Head Council is still deliberating when a decision requires missing facts or direct inspection.
- A Scout Worker has a short, explicit evidence question and uses read, measure, inspect, or analyze authority only. It cannot make production changes, expand scope, or decide the execution direction.
- Scout findings return to the spawning Department Head with source references, uncertainty, and observed limitations, then become available to the Head Council.
- Scout Workers terminate after returning their evidence.
- **Execution Workers** are spawned only after the Head Council has established the execution decision, ownership, boundaries, and validation criteria.
- Metronome detects Scouts that drift into implementation or are used to bypass the Council decision boundary.

### 22. Head Council deliberation protocol

1. **Independent brief:** Each participating Department Head records its own view of the Goal, risks, assumptions, dependencies, and required contribution before seeing other Heads' conclusions. This reduces anchoring and groupthink.
2. **Evidence gathering:** A Head may request a bounded Scout Worker when a material factual question cannot be resolved from available evidence.
3. **Open deliberation:** Heads challenge assumptions, surface cross-department conflicts, identify missing expertise, and add only new evidence or a distinct argument rather than repeating positions.
4. **Decision packet:** The Council records the selected direction, rejected alternatives and reasons, Department ownership, worker plan, completion and failure criteria, dissent, uncertainty, and any critical action.
5. **Stopping rule:** The discussion ends when material issues are resolved. It stops if two rounds add no new evidence or argument. Unresolved material conflict, high uncertainty, or a valid challenge routes to the selective Encore Council. Critical actions route to the CEO under the agreed boundary.

The Secretary chairs, keeps scope and records, and coordinates the result. The Secretary does not dominate domain judgments or erase dissent.

### 23. Department Context Packs — direction under design

Every permanent Department maintains a durable, scoped **Department Context Pack** so its Head reasons from the Department's actual position rather than a generic role description.

A Context Pack contains:

- Department charter: mission, responsibilities, boundaries, non-goals, and what the Department must protect.
- Department perspective: the questions, risks, trade-offs, and success measures it should apply to a Goal.
- Project-relevant facts and data available to that Department, with source, freshness, confidence, and access scope.
- Approved playbooks, checklists, prior decisions, Improvement Digests, recurring failure patterns, and proven successful patterns.
- Available capabilities, enrolled environments, tools, constraints, and authority limits.
- Current Goal slice: only the Goal facts, dependencies, decisions, and evidence relevant to this Department.
- Current workload, active workers, open handoffs, and unresolved obligations.

Context assembly principles:

- Every participating Head receives a shared Goal Brief plus its own Department Context Pack.
- Context is retrieved and assembled for relevance; the entire Department history is not injected into every discussion.
- A worker receives a smaller Mission Context derived by its Head: mission, bounded inputs, required interfaces, completion criteria, relevant evidence, and authority. It does not inherit the entire Head or Council context.
- Context entries retain provenance and freshness. Contradicted or stale entries are marked rather than silently trusted.
- Department data remains scoped. Cross-department sharing should expose the minimum evidence required for collaboration and decision-making.
- After milestones, useful outcomes flow through the agreed knowledge-promotion and Encore Digest processes rather than being appended indiscriminately to every future prompt.

### 24. Minimum necessary cross-department data sharing

- The Head Council shares each Department's position, material evidence, confidence, provenance, dependencies, and dissent rather than automatically exposing all raw Department data.
- A Department Head may request deeper evidence with a Goal-related purpose.
- Non-sensitive evidence required for the Goal may be provided automatically within the existing authority grant.
- Personal, secret, privileged, or unrelated information is redacted, summarized, or withheld.
- Security and Safety & Compliance may inspect protected evidence when their Goal-scoped responsibility requires it, but inspection does not authorize copying that material into unrelated durable memory.
- Shared evidence expires from active Goal context when it is no longer needed, while required audit references remain.

### 25. Ten-axis personality and persona system — direction under design

Every agent identity uses the existing ten normalized personality axes:

1. `agreeableness`
2. `extraversion`
3. `imagination`
4. `realism`
5. `conscientiousness`
6. `caution`
7. `initiative`
8. `empathy`
9. `adaptability`
10. `sociability`

Application rules:

- Every persistent Department Head, the Secretary, Encore Metronome, and each Encore Council persona has a stable identity, role charter, capabilities, limitations, current state, and ten-axis baseline.
- Every temporary worker also has a ten-axis profile for the life of its mission. The profile is derived from the Department's working style, the Head's delegation choice, and the mission's needs rather than cloning the Head or choosing random traits without purpose.
- Traits influence communication style, exploration versus restraint, initiative, collaboration, challenge behavior, escalation tendency, and adaptation. They do not grant permissions, change budgets, override evidence, weaken safety policy, or determine whether a claim is true.
- Department charter and professional duty take precedence over personality when they conflict.
- The Head Council should contain useful personality diversity. The multi-model Encore Council should also preserve independent perspectives rather than converging all personas toward the same agreeable profile.
- Trait changes are evidence-backed improvement candidates. Initial changes are evaluated in replay/synthetic shadow mode and cannot silently alter live authority or policy.
- The app shows identity and the three most distinctive axes by default, with the complete ten-axis profile available on expansion. The CEO can inspect and later edit an agent's persona and avatar.

The approved Secretary seed remains:

- agreeableness 0.70, extraversion 0.75, imagination 0.65, realism 0.90
- conscientiousness 0.95, caution 0.90, initiative 0.92, empathy 0.85
- adaptability 0.88, sociability 0.82

### 26. Persona initialization and editing

- Initial Department Head, Encore, and worker trait profiles are generated from each role's duty, perspective, and expected behavior.
- The CEO may inspect and edit all ten axes and the visible persona in the app.
- The app explains the expected behavioral effect of a proposed trait change before application.
- Trait changes are evaluated against representative replay/synthetic scenarios before live use and retain a rollback target.
- Worker profiles are mission-derived and expire with the worker. Persistent Head and Encore profiles are durable and versioned.

### 28. Skill, plugin, model, and capability assignment at spawn

Every spawned Head or worker receives a mission-specific assignment bundle:

- Stable role and ten-axis persona.
- Shared Goal Brief and the smallest relevant Department or Mission Context.
- Required skills and approved plugins selected from the approved native capability catalog.
- Allowed tools, project paths, virtual environments, enrolled-device scope, and external-service boundaries.
- Model selection or permitted model set appropriate to the mission.
- Cost, time, worker, and retry bounds.
- Deliverable, evidence, validation, reporting parent, and termination conditions.

Assignment follows least privilege. A skill being installed globally does not mean every agent receives or may use it. Missing capability may trigger a request to the Department Head, a Scout, or a new capability proposal; it cannot be silently added by a worker.

### 32. Git-first execution model — proposed structure

Git is the default source-control, isolation, integration, and evidence mechanism for code Goals.

- Every code Goal begins from an explicitly recorded base repository and immutable base revision.
- No worker edits the CEO's primary working directory or a shared branch directly.
- Each Execution Worker receives an isolated worktree and a uniquely owned worker branch bound to its Goal, Department, mission, and invocation identity.
- Scout Workers are read-only by default and do not receive a write branch unless their explicit deliverable is a repository artifact.
- Worker commits contain only mission-scoped changes and link to the Goal, worker mission, evidence, and validation result.
- A worker cannot push, merge to a shared or remote branch, rewrite unrelated history, or modify another worker's branch.
- The Department Head reviews worker commits and integrates accepted work into a Department-level Goal branch.
- Cross-department integration occurs on a Goal integration branch after interface and dependency checks.
- Quality and required specialist Departments validate the integrated Goal revision, not only isolated worker branches.
- Remote push, shared-branch merge, release, and deployment remain critical actions requiring CEO approval.
- Merge conflicts are treated as explicit integration work with ownership and validation, not resolved opportunistically by an unrelated worker.
- Branch, worktree, commit, diff, validation, integration, rollback, and cleanup events remain auditable and visible in the app.
- A branch or worktree is cleaned up only after its accepted commits are safely integrated or its rejected outcome is durably recorded. Cleanup must not erase required evidence.

Recommended hierarchy:

```text
recorded base revision
└── Goal integration branch
    ├── Product Department branch
    │   └── Product worker branches
    ├── Engineering Department branch
    │   └── Engineering worker branches
    └── Quality Department validation view
        └── read-only integrated-revision checks
```

### 33. Hierarchical Git model confirmed

The default code execution hierarchy is:

- Immutable recorded base revision.
- One Goal integration branch.
- One Department-level Goal branch for each writing Department.
- One uniquely owned branch and isolated worktree per writing worker.
- Read-only validation views for Quality and other reviewing Departments unless a separate remediation mission is explicitly created.

Accepted worker commits flow to the responsible Department branch, then accepted Department results flow to the Goal integration branch. Validation targets the integrated revision. The primary user workspace and shared branches remain untouched until the critical-action approval boundary is satisfied.

### 35. Secretary Office instead of a single Secretary

The CEO-facing coordination layer is a permanent **Secretary Office**.

- **Concertmaster** is the current primary Secretary identity and the CEO's continuous conversational interface. Concertmaster receives requests, maintains continuity, coordinates the Overture Crew, presents the final Task Contract, launches approved Goals, reports outcomes, and surfaces only critical interruptions.
- **Overture Crew** (or **Overture**) is a selectively activated intake and task-definition team. It works with the CEO in a `grill-me`-style conversation and produces one canonical `task.md` before orchestration begins.
- The Overture Crew is not a flat always-on chat room. Concertmaster wakes only the roles needed for the request.

Overture candidate pool (six selectively activated roles):

- **Conversation Lead** — speaks with the CEO in plain language, asks one intent question at a time, maintains shared understanding, and surfaces missing outcomes, boundaries, priorities, edge cases, and acceptance behavior for the Task Editor.
- **Architecture Analyst** — inspects authorized project evidence, current codebase structure, dependency graph, system topology, existing decisions, files, state, and constraints so the CEO is not asked questions the system can answer itself.
- **External Research Scout** — finds and verifies outside sources when the request requires current external evidence, library guidance, trends, or security advisories.
- **Security Evaluator** — records material risks, budget concerns, critical-action expectations, forbidden effects, and security boundary gaps before launch; it does not grant authority or approve a critical action.
- **Design & Mock Specialist** — creates disposable design explorations, visual options, or other previews only when seeing a candidate is necessary to clarify intent. A preview is not production implementation.
- **Task Editor** — maintains the canonical Task Contract, resolves contradictions, cites evidence and approved previews, and ensures the document is ready to launch.

A domain-specific specialist is not an always-on Overture role. When the Architecture Analyst identifies a bounded domain question, Concertmaster may create a read-only bounded Scout under the existing Scout-worker rules, with an explicit question, evidence scope, and termination condition. The Crew may later gain another permanent role only through the same evidence and Encore Council process used for organizational capability expansion.

### 36. `task.md` as the Goal launch contract

The Overture Crew produces one versioned `task.md` containing:

- CEO intent and desired outcome.
- User-visible behavior and success criteria.
- Scope, non-goals, priorities, constraints, and known edge cases.
- Evidence, project context, external research, and approved mock or preview references.
- Expected Groups and Departments, while allowing the Secretary and Head Council to discover justified additional existing Departments.
- Critical-action expectations, enrolled-device and environment needs, data boundaries, and external-service assumptions.
- Budget, time, reporting expectations, and stopping conditions at the level meaningful to the CEO.
- Acceptance evidence required before success may be reported.
- Document version, decision history, CEO launch state, and a content identity binding the launched Goal to the agreed contract.

Once launched, the Task Contract becomes the stable source of intent for Concertmaster, the Head Council, Department Context assembly, workers, Quality, Encore, and final reporting. Material scope changes create a visible amendment and revised contract identity rather than silently changing the active Goal.

### 37. Single Goal launch confirmation

- Completing `task.md` does not silently start execution.
- Concertmaster presents a concise plain-language summary of the final Task Contract and asks for one explicit launch confirmation from the CEO.
- The confirmation binds the launched Goal to that Task Contract version and content identity.
- After launch, the organization proceeds end to end without intermediate approval requests unless a critical action, material contract amendment, or genuinely unrecoverable ambiguity crosses an agreed boundary.
- Ordinary retries, replanning, Department activation, worker spawning, local Git work, testing, and bounded environment or enrolled-device actions continue automatically and are reported afterward.

### 38. Role-aware model, skill, and plugin selection

- Selection is quality-gated and then cost-optimized: among models demonstrated capable of meeting the mission's quality and safety requirements, choose the lowest-cost suitable option.
- Concertmaster uses a stable high-quality model appropriate for persistent CEO interaction and judgment continuity.
- The Overture Conversation Lead and Task Editor use models capable of accurately preserving intent and resolving contradictions.
- Project and External Scouts prefer lower-cost retrieval and synthesis models and escalate only when evidence conflict or complexity requires it.
- Department Heads use strong reasoning models appropriate for planning, delegation, negotiation, and evidence synthesis.
- Workers receive the smallest model demonstrated capable of their specific mission. Model size is not inherited automatically from the Head.
- Metronome uses deterministic checks before model judgment and invokes a low-cost model only for ambiguity that rules cannot resolve.
- The Encore Council uses genuinely distinct approved models when available. If only one provider or model family is available, it uses independently isolated contexts and diverse personas and reports the limitation honestly.
- A creator does not evaluate its own candidate when an independent approved evaluator is available. At minimum, evaluation uses isolated context and criteria fixed before candidate execution.
- Skills and plugins are selected per mission from the approved native capability catalog. Installed availability does not imply assignment.
- The assignment bundle includes only capabilities that contribute to the mission, reducing context, authority, and attack surface.
- Outcome telemetry continuously measures role/model/skill combinations. Encore may refine routing under the staged-improvement authority without lowering the required quality floor.

### 39. Evidence-driven flexible Goal budgeting

Budget allocation is adaptive rather than a fixed percentage template.

- Encore analyzes the final Task Contract, relevant project state, similar historical Goals, Improvement Digests, Department and role success rates, model and skill cost, token use, latency, retry patterns, uncertainty, and expected validation burden.
- It produces an initial allocation range for initiation, deliberation, each active Department, independent validation, recovery reserve, and Encore evidence processing.
- Concertmaster and the Head Council may reallocate unused budget inside the approved Goal ceiling as evidence and progress change.
- Department Heads allocate their current Department budget among Scouts and Execution Workers.
- Forecasts update after meaningful milestones. The system may reduce unnecessary workers, discussion, context, or model cost before consuming recovery reserve.
- Quality, required Security or Safety review, and minimum recovery capacity retain protected floors appropriate to the Goal. They cannot be reduced to zero to make execution appear affordable.
- Historical data guides but does not dictate allocation. New Departments, novel work, and sparse data receive explicit uncertainty and an exploration allowance rather than being starved because they lack a track record.
- Recent relevant evidence is weighted more strongly than stale or superficially similar history. Outcomes are evaluated for quality and safety, not only low spend.
- Encore may optimize allocation within the approved ceiling. Increasing the total ceiling remains a critical budget action requiring CEO approval.
- The CEO can inspect current spend, forecast, allocation changes, evidence behind the changes, and remaining probability of completion in the app.

### 60. Department Plans owned by Department Heads

- Every activated Department Head writes and owns a versioned **Department Plan** after the Head Council establishes the Goal decision and before that Head spawns execution workers.
- A Department Plan states the Department's contribution, non-goals, dependencies, worker assignments, order and safe parallelism, budget and time expectations, Git integration path, risks, evidence requirements, and validation criteria.
- Department Plans are first-class Goal artifacts visible to Concertmaster, the other activated Heads, Metronome, Quality, and the CEO.
- The Head Council reconciles overlaps, gaps, conflicting assumptions, and cross-department dependencies before execution begins. Concertmaster records the agreed plan set but does not silently rewrite a Head's domain judgment.
- Workers receive the active Department Plan version and a bounded worker brief. Their results link back to the plan items they satisfy.
- A Head may update its Department Plan as evidence changes. Every revision records the reason, affected work, cost or schedule effect, and whether another Department is affected.
- Routine revisions inside the approved Goal, authority, and budget proceed without renewed CEO approval. A material cross-department change returns to the Head Council. A Goal change or critical authority, budget, external-effect, or irreversible change follows the CEO approval boundary.
- Metronome detects work that has no active plan item, stale workers running against superseded plans, hidden scope growth, contradictory Department Plans, and execution that diverges from the Council decision.
- Final certification checks both the Goal contract and the fulfilled Department Plans. A completed task list alone cannot override a failed Goal outcome.


## Ensemble Router routing contract — adopted design

The Department Head Council declares D requirements and E work-character inputs; the native router selects one qualifying model; admission remains authoritative. The full rules live in [Ensemble Router — Automatic Routing](active/2026-09-08-ensemble-router-routing-design.md).

- During decomposition, each Mission Bundle receives versioned task-kind axis-role recipes over exactly eight D axes paired to A. The Head then records a runtime TaskDemand with one explicit `0..200` level and rationale per axis.
- Provider facts B are hard filters: context capacity, input/output pricing, authentication, data policy, modalities, and tool support. Operational measurements C are local corrections for latency, cost, failures/timeouts, provider errors, and availability/account binding.
- The Head records E risk, reversibility, verification attachment, material scale, time pressure, and budget headroom. The first three compute continuous pressure; the last three constrain B/C. The Head may uplift pressure, never lower the computed floor.
- A↔D matching is weakest-link. Strength on one required capability cannot hide a shortfall on another. Matching strictness is a smooth function of pressure, not a `50/100/200` lookup.
- Four pressure bands — low, medium, high, critical — project automatic, Department Head, Encore Council, and user decision authority. Bands are for approval, escalation, recording, and reporting only; they do not change matching.
- A pin is considered first but never bypasses B/C or A↔D checks. Explicit routing-off mode is development-only and leaves a routing/certification marker.
- If no model qualifies, the system records the exact hard-filter or paired-axis shortfall and escalates through the pressure-band authority. No provider outage or budget optimization silently lowers requirements.
- Connection, rate-limit, and provider-outage failures retry the same model. A switch is automatic only when the replacement still matches, and it always creates a new native admission/binding identity. Automatic below-requirement downgrade is forbidden.
- Conversations keep one model for their lifetime. Heavy work is promoted to a Goal instead of silently upgrading a long conversation.

### Mission Bundle and migration boundary

The current `approvedModels` list and exact `modelPolicy` path remain a transition guard while the router is introduced. The target contract adds versioned D recipes, E work-character inputs, continuous pressure, pressure-band projection, pin/routing mode, and profile version; the selected routed identity is then projected into the existing exact admission policy. `MAESTRO_NATIVE_MODEL` is an explicit fixed-model pin/routing-off migration mode, never an implicit fallback or bypass. The router intersects candidates with `approvedModels`; native admission still receives exactly one selected model.

### Phase 2 routing work order and tests

1. Draft the A eight-axis scoring rubric, B fact schema, C operational overlay, static D recipes, runtime TaskDemand declaration policy, E work-character schema, continuous pressure function, four band thresholds, and Mission Bundle fields.
2. Write RED tests for weakest-link A↔D matching, B/C hard-filter precedence, smooth pressure strictness, band-only authority projection, pin-as-preference, no-candidate escalation, and no automatic below-requirement downgrade.
3. Implement the smallest provider-neutral router and project its single result into the existing native admission contract.
4. Record A/D requirements, E inputs, pressure, band, routed model, candidate set, rejected reasons, B/C observations, and profile version in the separate routing evidence store.
5. Verify Head, Overture, Worker, Scout, Helper, Semantic Review, Encore reviewer, and Metronome callers use the common contract rather than ad-hoc model selection.
