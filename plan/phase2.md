# Phase 2 — Secretary Office Core and Hierarchical Goal Execution

## Outcome

Turn the durable foundation into the complete execution hierarchy for one local software Goal. Sane conducts intake, the Overture Crew produces one Task Contract, the CEO confirms once, only required Heads wake, each Head writes a Department Plan, and bounded Scout and Execution workers deliver isolated Git results.

Overwatch certification is completed in Phase 3, so Phase 2 cannot yet report a Goal as fully successful.

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

Groups are containers, not agents. Sane convenes Goal-scoped Department Heads directly. Sleeping Departments have durable identity and knowledge but no running session and receive no Goal context.

## Sane and Task Contract flow

1. CEO states an outcome in plain language through app or CLI.
2. Sane creates a draft Goal and activates the smallest required Overture Crew roles.
3. Project Context Scout reads authorized project evidence.
4. External Research Scout activates only when current outside evidence is needed.
5. Requirements Analyst identifies outcomes, non-goals, priorities, edge cases, and acceptance behavior.
6. Design & Mock Specialist creates disposable previews only when seeing an option is necessary.
7. Task Editor maintains one versioned `task.md`.
8. Sane presents the complete contract, expected effects, initial budget range, and authority boundary.
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

Sane activates the smallest likely set. An active Head may request another existing Head by supplying Goal, reason, evidence, requested contribution, urgency, context scope, and budget effect. The control plane prevents duplicate and cyclic activation. New Departments remain outside this phase and require later Council approval.

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

The Head Council reconciles overlap, gaps, and contradictions. Sane records the agreed set without silently rewriting domain judgment. Workers bind to an active plan version and link every result to satisfied plan items.

A Head may revise its plan when evidence changes. The revision records cause, affected items, workers, cost, schedule, and cross-department effect. In-scope changes proceed automatically. Cross-department changes return to the Head Council. Goal, budget-ceiling, authority, or critical-effect changes return to the CEO boundary.

## Worker authority and hierarchy

- Only a Department Head may create ordinary workers.
- A worker that needs help requests it from its Head; it cannot silently create a child hierarchy.
- A Head may designate a bounded team-lead worker only for a large mission. The grant fixes maximum helpers, cost, duration, task scope, reporting, and revocation.
- Helpers created under that exception still belong to the Department Plan and remain visible to the Head and Sentinel.
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

Sane starts at:

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

Persistent Heads, Sentinel, and Council personas receive reviewed duty-derived baselines. Temporary workers receive a mission profile derived from Department style, Head choice, task ambiguity, risk, collaboration demand, and evidence burden. Worker overlays expire with the mission.

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
- Sane and Heads use models strong enough for continuity, planning, delegation, and synthesis.
- Scouts prefer lower-cost retrieval models and escalate on conflict or complexity.
- Workers use the smallest model proven for that mission rather than inheriting the Head model.
- Skills are selected per mission to reduce context and authority surface.
- Record actual provider, model, skill, plugin, cost, latency, and result for later routing improvement.

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

Overwatch policy produces an initial range using task uncertainty, historical evidence when available, model cost, expected validation, and recovery reserve. Sane and the Head Council may reallocate inside the CEO ceiling. Each Head allocates its Department budget. Quality and recovery floors cannot be reduced to make execution appear affordable. Increasing the total ceiling requires CEO approval.

## Work sequence

1. Implement permanent organization and durable role/persona records.
2. Implement Sane session binding and Overture Crew selection.
3. Implement Task Contract editor, content identity, amendment, and confirmation.
4. Implement Head activation, sleep/resume, duplicate prevention, and bounded Head-to-Head calls.
5. Implement sealed independent briefs and Council discussion rounds.
6. Implement Department Plan schema, reconciliation, revisions, and worker linkage.
7. Implement mission bundles and least-privilege capability selection.
8. Implement Scout and Execution worker lifecycles through Prime Agent native hierarchy.
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
17. Real worker completes and tests a disposable local project change.
18. App and CLI display the same Task Contract, hierarchy, plan versions, budget, and Git state.

## Exit gate

A plain-language request must become one confirmed Task Contract. Only the necessary Heads activate, write independent briefs, deliberate, and own versioned Department Plans. Scouts gather evidence; Execution workers complete a real isolated local change; Heads integrate accepted commits into one Goal revision. No worker can create hidden workers, exceed authority, write another branch, or push remotely. The Goal remains `awaiting certification` until Phase 3.

## Requirements preserved in this phase

### 1. Organization shape

- The CEO communicates primarily through the Secretary.
- The Secretary acts as Chief of Staff and coordinates Department Heads.
- Department Heads own distinct functional areas and collaborate with other Heads when a goal crosses domains.
- Workers are temporary, task-scoped agents spawned by a Department Head.
- Workers report to their spawning Head rather than joining a flat global agent pool.
- Departments that are not needed remain asleep or on standby.
- Overwatch observes the whole orchestration system from outside the execution hierarchy.

### 2. Selective department activation

Use a two-stage activation model:

1. Sane initially wakes the smallest set of Departments likely to be required.
2. During discussion or execution, an awakened Department Head may directly wake another existing Department Head when missing expertise, a new dependency, or an independent challenge is discovered.
3. The calling Head supplies a bounded activation brief with the Goal, reason, evidence, requested contribution, urgency, context scope, and expected budget impact.
4. Sane records the activation, prevents duplicates, updates Council membership and context routing, and coordinates budget or schedule effects, but does not act as a routine approval gate.
5. Sentinel detects cyclic, duplicative, unjustified, or runaway activation. Creating a new Department still requires Overwatch Council approval.

**Reason:** This avoids waking every Department for every Goal, does not require Sane to predict every dependency at intake time, and lets domain experts bring in the expertise they discover they need without administrative delay.

### 6. Default permanent departments

Start with five permanent departments:

1. **Product & Design** — requirements, prioritization, user experience, and interface design.
2. **Engineering** — frontend, backend, data, infrastructure, and implementation workers.
3. **Research** — technical investigation, market and competitor research, source verification, and evidence gathering.
4. **Quality & Safety** — independent testing, review, security, safety, and acceptance validation. This department remains organizationally separate from implementation.
5. **Operations** — Goal operations, incidents, state, cost, Git/worktree coordination, and operational readiness.

The Secretary is the CEO's Chief of Staff, not a department. Overwatch is an independent oversight layer, not a department. A recurring capability may become a new permanent department only after Overwatch Council approval.

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
- A Group Head may be proposed later only when the Group has grown enough that repeated coordination failures demonstrate a real need. Creating that role requires Overwatch Council approval under the same capability-expansion rule used for new departments.

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
- Sentinel monitors worker multiplication, duplicated effort, idle time, cost, and scope drift and may request a safe pause.

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
- Sentinel detects Scouts that drift into implementation or are used to bypass the Council decision boundary.

### 22. Head Council deliberation protocol

1. **Independent brief:** Each participating Department Head records its own view of the Goal, risks, assumptions, dependencies, and required contribution before seeing other Heads' conclusions. This reduces anchoring and groupthink.
2. **Evidence gathering:** A Head may request a bounded Scout Worker when a material factual question cannot be resolved from available evidence.
3. **Open deliberation:** Heads challenge assumptions, surface cross-department conflicts, identify missing expertise, and add only new evidence or a distinct argument rather than repeating positions.
4. **Decision packet:** The Council records the selected direction, rejected alternatives and reasons, Department ownership, worker plan, completion and failure criteria, dissent, uncertainty, and any critical action.
5. **Stopping rule:** The discussion ends when material issues are resolved. It stops if two rounds add no new evidence or argument. Unresolved material conflict, high uncertainty, or a valid challenge routes to the selective Overwatch Council. Critical actions route to the CEO under the agreed boundary.

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
- After milestones, useful outcomes flow through the agreed knowledge-promotion and Overwatch Digest processes rather than being appended indiscriminately to every future prompt.

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

- Every persistent Department Head, the Secretary, Overwatch Sentinel, and each Overwatch Council persona has a stable identity, role charter, capabilities, limitations, current state, and ten-axis baseline.
- Every temporary worker also has a ten-axis profile for the life of its mission. The profile is derived from the Department's working style, the Head's delegation choice, and the mission's needs rather than cloning the Head or choosing random traits without purpose.
- Traits influence communication style, exploration versus restraint, initiative, collaboration, challenge behavior, escalation tendency, and adaptation. They do not grant permissions, change budgets, override evidence, weaken safety policy, or determine whether a claim is true.
- Department charter and professional duty take precedence over personality when they conflict.
- The Head Council should contain useful personality diversity. The multi-model Overwatch Council should also preserve independent perspectives rather than converging all personas toward the same agreeable profile.
- Trait changes are evidence-backed improvement candidates. Initial changes are evaluated in replay/synthetic shadow mode and cannot silently alter live authority or policy.
- The app shows identity and the three most distinctive axes by default, with the complete ten-axis profile available on expansion. The CEO can inspect and later edit an agent's persona and avatar.

The approved Secretary seed remains:

- agreeableness 0.70, extraversion 0.75, imagination 0.65, realism 0.90
- conscientiousness 0.95, caution 0.90, initiative 0.92, empathy 0.85
- adaptability 0.88, sociability 0.82

### 26. Persona initialization and editing

- Initial Department Head, Overwatch, and worker trait profiles are generated from each role's duty, perspective, and expected behavior.
- The CEO may inspect and edit all ten axes and the visible persona in the app.
- The app explains the expected behavioral effect of a proposed trait change before application.
- Trait changes are evaluated against representative replay/synthetic scenarios before live use and retain a rollback target.
- Worker profiles are mission-derived and expire with the worker. Persistent Head and Overwatch profiles are durable and versioned.

### 28. Skill, plugin, model, and capability assignment at spawn

Every spawned Head or worker receives a mission-specific assignment bundle:

- Stable role and ten-axis persona.
- Shared Goal Brief and the smallest relevant Department or Mission Context.
- Required skills and approved plugins selected from the Prime Agent capability catalog.
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

- **Sane** is the current primary Secretary identity and the CEO's continuous conversational interface. Sane receives requests, maintains continuity, coordinates the Overture Crew, presents the final Task Contract, launches approved Goals, reports outcomes, and surfaces only critical interruptions.
- **Overture Crew** (or **Overture**) is a selectively activated intake and task-definition team. It works with the CEO in a `grill-me`-style conversation and produces one canonical `task.md` before orchestration begins.
- The Overture Crew is not a flat always-on chat room. Sane wakes only the roles needed for the request.

Initial Overture Crew roles:

- **Conversation Lead** — speaks with the CEO in plain language, asks one intent question at a time, and maintains the shared understanding.
- **Project Context Scout** — inspects the current project, existing decisions, files, state, and constraints so the CEO is not asked questions the system can answer itself.
- **External Research Scout** — finds and verifies outside sources when the request requires current or domain evidence.
- **Requirements & Edge-Case Analyst** — identifies missing outcomes, boundaries, acceptance conditions, priorities, and real-world failure cases.
- **Design & Mock Specialist** — creates disposable design explorations, visual options, or other previews when seeing a candidate is necessary to clarify intent. A preview is not production implementation.
- **Task Editor** — maintains the canonical Task Contract, resolves contradictions, cites evidence and approved previews, and ensures the document is ready to launch.

The Crew may later gain another role through the same evidence and Overwatch Council process used for organizational capability expansion.

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

Once launched, the Task Contract becomes the stable source of intent for Sane, the Head Council, Department Context assembly, workers, Quality, Overwatch, and final reporting. Material scope changes create a visible amendment and revised contract identity rather than silently changing the active Goal.

### 37. Single Goal launch confirmation

- Completing `task.md` does not silently start execution.
- Sane presents a concise plain-language summary of the final Task Contract and asks for one explicit launch confirmation from the CEO.
- The confirmation binds the launched Goal to that Task Contract version and content identity.
- After launch, the organization proceeds end to end without intermediate approval requests unless a critical action, material contract amendment, or genuinely unrecoverable ambiguity crosses an agreed boundary.
- Ordinary retries, replanning, Department activation, worker spawning, local Git work, testing, and bounded environment or enrolled-device actions continue automatically and are reported afterward.

### 38. Role-aware model, skill, and plugin selection

- Selection is quality-gated and then cost-optimized: among models demonstrated capable of meeting the mission's quality and safety requirements, choose the lowest-cost suitable option.
- Sane uses a stable high-quality model appropriate for persistent CEO interaction and judgment continuity.
- The Overture Conversation Lead and Task Editor use models capable of accurately preserving intent and resolving contradictions.
- Project and External Scouts prefer lower-cost retrieval and synthesis models and escalate only when evidence conflict or complexity requires it.
- Department Heads use strong reasoning models appropriate for planning, delegation, negotiation, and evidence synthesis.
- Workers receive the smallest model demonstrated capable of their specific mission. Model size is not inherited automatically from the Head.
- Sentinel uses deterministic checks before model judgment and invokes a low-cost model only for ambiguity that rules cannot resolve.
- The Overwatch Council uses genuinely distinct approved models when available. If only one provider or model family is available, it uses independently isolated contexts and diverse personas and reports the limitation honestly.
- A creator does not evaluate its own candidate when an independent approved evaluator is available. At minimum, evaluation uses isolated context and criteria fixed before candidate execution.
- Skills and plugins are selected per mission from the approved Prime Agent catalog. Installed availability does not imply assignment.
- The assignment bundle includes only capabilities that contribute to the mission, reducing context, authority, and attack surface.
- Outcome telemetry continuously measures role/model/skill combinations. Overwatch may refine routing under the staged-improvement authority without lowering the required quality floor.

### 39. Evidence-driven flexible Goal budgeting

Budget allocation is adaptive rather than a fixed percentage template.

- Overwatch analyzes the final Task Contract, relevant project state, similar historical Goals, Improvement Digests, Department and role success rates, model and skill cost, token use, latency, retry patterns, uncertainty, and expected validation burden.
- It produces an initial allocation range for initiation, deliberation, each active Department, independent validation, recovery reserve, and Overwatch evidence processing.
- Sane and the Head Council may reallocate unused budget inside the approved Goal ceiling as evidence and progress change.
- Department Heads allocate their current Department budget among Scouts and Execution Workers.
- Forecasts update after meaningful milestones. The system may reduce unnecessary workers, discussion, context, or model cost before consuming recovery reserve.
- Quality, required Security or Safety review, and minimum recovery capacity retain protected floors appropriate to the Goal. They cannot be reduced to zero to make execution appear affordable.
- Historical data guides but does not dictate allocation. New Departments, novel work, and sparse data receive explicit uncertainty and an exploration allowance rather than being starved because they lack a track record.
- Recent relevant evidence is weighted more strongly than stale or superficially similar history. Outcomes are evaluated for quality and safety, not only low spend.
- Overwatch may optimize allocation within the approved ceiling. Increasing the total ceiling remains a critical budget action requiring CEO approval.
- The CEO can inspect current spend, forecast, allocation changes, evidence behind the changes, and remaining probability of completion in the app.

### 60. Department Plans owned by Department Heads

- Every activated Department Head writes and owns a versioned **Department Plan** after the Head Council establishes the Goal decision and before that Head spawns execution workers.
- A Department Plan states the Department's contribution, non-goals, dependencies, worker assignments, order and safe parallelism, budget and time expectations, Git integration path, risks, evidence requirements, and validation criteria.
- Department Plans are first-class Goal artifacts visible to Sane, the other activated Heads, Sentinel, Quality, and the CEO.
- The Head Council reconciles overlaps, gaps, conflicting assumptions, and cross-department dependencies before execution begins. Sane records the agreed plan set but does not silently rewrite a Head's domain judgment.
- Workers receive the active Department Plan version and a bounded worker brief. Their results link back to the plan items they satisfy.
- A Head may update its Department Plan as evidence changes. Every revision records the reason, affected work, cost or schedule effect, and whether another Department is affected.
- Routine revisions inside the approved Goal, authority, and budget proceed without renewed CEO approval. A material cross-department change returns to the Head Council. A Goal change or critical authority, budget, external-effect, or irreversible change follows the CEO approval boundary.
- Sentinel detects work that has no active plan item, stale workers running against superseded plans, hidden scope growth, contradictory Department Plans, and execution that diverges from the Council decision.
- Final certification checks both the Goal contract and the fulfilled Department Plans. A completed task list alone cannot override a failed Goal outcome.
