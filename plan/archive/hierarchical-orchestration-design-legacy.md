# Hierarchical Orchestration Design

**Status:** Design interview complete; awaiting explicit design approval. No implementation is approved.
**Last updated:** 2026-08-31

## Purpose

Define Maestro as a selective, hierarchical organization rather than a flat roster of peer agents.
Department Heads act like functional directors: they discuss cross-domain work, spawn bounded workers, review their departments' results, and return to standby when the goal is complete. Overwatch remains outside the command chain and improves the orchestration system by observing it end to end.

## Agreed Decisions

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
- Any action for which Sentinel detects a credible risk of unrecoverable harm.

All other work uses execute-then-report within existing permissions and budget. This includes code changes in isolated worktrees, local commits, tests, documentation, refactoring, bounded worker creation, analysis, and replay/synthetic shadow experiments.

When an action is stopped, the CEO report must contain the proposed action, expected benefit, concrete risk, rollback feasibility, Council decision and dissent, and the minimum choice required from the CEO.

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

### 10. Virtual environments and external device access — direction under design

- Workers should normally execute inside isolated, task-scoped virtual environments rather than directly in the user's main workspace.
- Environments should support the tools required for the assigned work, including project CLIs and browser or desktop interaction when appropriate.
- A worker's environment and access authority are distinct: having a tool installed does not grant access to the user's computer, credentials, or external services.
- Access to the user's computer or CLI should use an explicitly enrolled device and a bounded, auditable Goal-scoped authority grant.
- The preferred operating model is one-time device enrollment, least-privilege access for each Goal, full command and result audit, and automatic expiry when the Goal ends.
- Noncritical actions within the granted scope may follow execute-then-report. Critical actions remain behind the agreed CEO approval boundary.
- Sentinel observes device access, command scope, unexpected side effects, and authority expiry. It may pause execution when the observed behavior escapes the approved Goal scope.

### 11. Enrolled-device automation level

- The CEO enrolls a computer or CLI endpoint once.
- For each Goal, Maestro grants only the access required for the stated outcome and expires that authority when the Goal closes.
- Within an enrolled project scope, workers may automatically read and edit project files, run project CLIs and tests, start local applications, operate a browser, and capture evidence without asking for each action.
- These ordinary actions follow execute-then-report and remain fully audited.
- Access to unrelated personal folders, system-wide changes, external sending, permanent deletion, payment, login or authority changes, or any other critical action stops for CEO approval.
- Device enrollment never implies unrestricted access. A Goal must still establish a bounded scope.
- Sentinel may pause access when behavior escapes the Goal, reaches an unexpected resource, or produces side effects outside the granted scope.

### 12. Department Head worker authority

- A Department Head may autonomously spawn the bounded workers needed for its assigned contribution without per-worker CEO approval.
- Independent work may run in parallel. Work that shares mutable scope must be sequenced or explicitly coordinated.
- Every worker starts with one named mission, completion criteria, bounded scope, expected cost, and a reporting Department Head.
- Workers do not spawn other workers.
- Duplicate workers, overlapping ownership, and workers without a concrete deliverable are prohibited.
- A worker terminates when its mission completes, becomes unnecessary, exceeds its bounds, or cannot make useful progress.
- Material expansion beyond the Goal's expected scope or budget returns to the Head Council for review.
- Sentinel monitors worker multiplication, duplicated effort, idle time, cost, and scope drift and may request a safe pause.

### 13. Overwatch Improvement Organization — proposed structure

Overwatch should include a selectively activated improvement organization that improves the orchestration system itself rather than executing normal CEO Goals.

- **Overwatch Sentinel** remains the lightweight continuous observer and trigger source.
- **Overwatch Council** remains the selective multi-model adjudicator for important Goal decisions and improvement judgments.
- **Overwatch Improvement Lab** wakes only when Sentinel detects sufficient evidence, a recurring failure, a material inefficiency, an incident, or a scheduled review threshold. It contains task-scoped specialist roles:
  - **Organization Architect** — evaluates whether Groups, Departments, Head responsibilities, activation rules, and handoffs should change.
  - **Efficiency Analyst** — evaluates token use, cost, latency, redundant deliberation, unnecessary department activation, and model choice.
  - **Process Engineer** — proposes changes to planning, delegation, context transfer, worker limits, review, recovery, and reporting.
  - **Evaluation & Simulation** — builds replay/synthetic scenarios, compares the current system with a candidate, checks for regressions, and validates rollback.
- These are not continuously running permanent production departments. They are awakened only for a specific improvement hypothesis.
- The Lab produces a bounded candidate with a hypothesis, expected benefit, affected behavior, evidence, evaluation plan, failure conditions, and rollback plan.
- Candidate generation and evaluation occur outside live Goal routing. A candidate cannot silently redefine its own evaluator or success criteria.
- The Overwatch Council reviews the Lab's evidence from multiple independent model perspectives and records the decision, dissent, confidence, and allowed next step.
- Improvement outcomes are reported to the CEO with measured token, cost, latency, quality, and safety deltas rather than vague claims.

### 14. Staged application of validated improvements

- The initial Overwatch improvement lifecycle remains replay/synthetic and shadow-only.
- The CEO may later enable a narrowly defined class of improvements for automatic live application after that class has accumulated sufficient successful shadow evidence.
- Within an enabled class, only low-risk, reversible changes may be automatically applied. The CEO receives an evidence-backed report afterward.
- Live application requires an intact rollback path, bounded exposure, independent monitoring, and automatic rollback when quality, safety, latency, cost, or reliability crosses its allowed threshold.
- Example candidates for future enabled classes include discussion order, worker concurrency limits, summary format, context-transfer size, and low-cost model selection within an already approved provider and model set.
- New Groups or Departments, permission expansion, budget changes, provider changes, external access expansion, secrets, deployment, deletion, and operating-policy changes remain outside automatic application.
- Enabling one improvement class does not authorize another. Authority is explicit, narrow, revocable, and auditable.

### 15. Bounded cross-department worker collaboration

- Workers normally communicate through their own Department Heads and the Goal-scoped Head Council.
- Direct collaboration between workers from different Departments is allowed only when the work requires close coordination, such as an interface contract, integration, or shared investigation.
- Both Department Heads establish the collaboration purpose, scope, expected output, and duration.
- The channel is bound to one Goal and closes automatically when the collaboration completes or the Goal ends.
- Messages, transferred artifacts, and decisions remain auditable.
- Workers cannot use a direct channel to expand scope, create workers, change authority, or make a cross-department policy decision.
- Unresolved disagreement returns to the responsible Department Heads.

### 16. Data-management model — direction under design

Maestro should not treat all data as one shared memory. Data is separated by purpose and authority:

1. **Project source and artifacts** — repositories, files, local commits, reports, screenshots, generated assets, and deliverables. Git or the project's native artifact system remains the source of truth where applicable.
2. **Operational state** — Goals, active Groups and Departments, Head Council membership, worker missions, leases, decisions, approvals, device grants, and current execution status.
3. **Organizational knowledge** — project-specific facts, Department playbooks, reusable procedures, CEO preferences, learned constraints, and prior decision rationales. Every item carries source, scope, owner, confidence, and freshness information.
4. **Evidence and telemetry** — Council transcripts, Sentinel findings, command and tool records, evaluation results, cost, token use, latency, failures, rollback evidence, and Overwatch improvement comparisons. This evidence is append-oriented and cannot be silently rewritten by the candidate it evaluates.
5. **Secrets and authority** — credentials, tokens, device enrollment material, and access grants. These remain in a separate protected store and are referenced by capability, never copied into ordinary prompts, memory, reports, or logs.

Additional principles:

- Project boundaries are private by default. A worker receives only the data needed for its Goal and mission.
- Temporary worker environments are disposable. A worker's scratch data does not automatically become organizational memory.
- Before a worker terminates, its Department Head promotes only the required deliverables, evidence, decisions, and useful lessons into the appropriate durable layer.
- Current state may be updated, but material transitions also produce durable events so recovery and audit do not depend on mutable snapshots alone.
- Data shown to Overwatch should be sufficient for evaluation while minimizing unrelated content and secret exposure.
- Deletion and retention follow the critical-action boundary and must not be hidden inside routine cleanup.

### 17. Project-private knowledge with curated cross-project lessons

- Project code, conversations, business information, artifacts, and detailed execution history remain inside that project by default.
- CEO preferences and global safety rules may apply across projects.
- Cross-project reuse is limited to verified, generalized lessons that remove project-specific content, personal information, secrets, and unnecessary source material.
- Shared lessons preserve provenance to the originating evidence without exposing the evidence to unrelated projects.
- Low-confidence, stale, contradicted, or highly context-dependent lessons are weakened, revalidated, or retired rather than treated as universal truth.

### 18. Milestone-based Overwatch Improvement Digests

Overwatch receives curated improvement evidence at natural completion boundaries rather than ingesting every raw log as memory.

Digest triggers include:

- Completion, failure, retry exhaustion, or cancellation of a worker mission or small execution unit.
- Completion of a Department contribution or cross-department handoff.
- A Head Council decision, reconsideration, or escalation.
- Goal completion, rollback, incident, or CEO intervention.
- A meaningful cost, token, latency, quality, or safety threshold crossing.

The digest pipeline:

1. Sentinel links the bounded episode's Goal, Department, worker, decisions, actions, outcomes, and measurements.
2. A curation step removes routine noise, duplicated messages, secrets, unrelated content, and evidence with no improvement value.
3. Valuable episodes are normalized into an **Improvement Digest** containing the situation, selected decision, rejected alternatives when relevant, observed result, quality/cost/token/latency/safety deltas, failure or success factors, confidence, and source references.
4. Digests are ranked by impact, novelty, recurrence, confidence, and actionability.
5. The Overwatch Improvement Lab consumes the selected digests to form and test improvement hypotheses.
6. Cross-project promotion uses only the generalized lesson, never the raw project log.

Successful patterns, failures, near misses, unnecessary work, and avoided work are all eligible. Overwatch must not optimize only for failure reduction or token reduction at the expense of outcome quality.

Raw logs remain evidence and are not rewritten into conclusions. A digest may be corrected or superseded, but its evidence link and prior version remain auditable.

### 19. Data retention and deletion

Default retention periods are:

- Worker scratch files and detailed execution logs: 30 days after Goal closure.
- Ordinary conversations and full Head Council transcripts: 90 days.
- Cost, evaluation, audit, incident, certification, and rollback evidence: for the lifetime of the project.
- Selected Improvement Digests and material decision records: until explicitly superseded, retired, or removed under policy.
- Secrets: never written to ordinary logs, transcripts, memory, or digests.

Retention is a maximum, not a requirement to preserve noise. Data may be compacted earlier when its evidentiary and operational value has ended, provided required audit links remain intact.

A CEO request to delete a project's records must also trace cross-project lessons derived from that project. Each derived lesson is then removed, re-sourced, or revalidated without the deleted evidence. Deletion remains a critical action and must produce an auditable scope and outcome report.

### 20. Knowledge promotion authority

- A worker may propose a lesson with evidence but cannot directly write or overwrite durable organizational knowledge.
- A Department Head may promote an evidence-backed lesson into project- and Department-scoped knowledge.
- The Overwatch Improvement Lab may synthesize recurring patterns into a candidate generalized lesson.
- The multi-model Overwatch Council approves lessons intended for reuse across projects.
- The CEO may pin, challenge, request correction of, or retire any organizational knowledge.
- A single success or failure cannot become a global rule without corroboration.
- Corrections preserve provenance: incorrect or stale knowledge is marked superseded or retired with a replacement reason rather than silently rewritten.
- Confidence and freshness decay when evidence ages, conditions change, or new outcomes contradict the lesson.

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

### 27. Prime Agent is the execution kernel

Maestro is designed to run **on top of Prime Agent**, not to replace Prime Agent with a second independent agent runtime.

Responsibility boundary:

- **Maestro owns:** CEO Goals, Secretary workflow, Groups and Departments, Head Council policy, selective activation, Department Context Packs, data and authority policy, budget and critical-action gates, organizational UI, outcome reporting, and Overwatch improvement objectives.
- **Prime Agent owns:** model execution, recursive subagent spawning, parent/child messaging, observation, task environments, tool execution, skill and plugin availability, model selection surfaces, and the continual harness used by refinement.

Runtime mapping:

- Waking a Department Head means spawning or resuming a Prime Agent subagent from that Head's durable organizational identity and harness specification.
- A Head spawns Scout or Execution Workers as its direct Prime Agent children. This preserves the intended reporting hierarchy in the runtime itself.
- Sleeping a Department Head terminates active execution while preserving the Head's approved identity, Department Context Pack, traits, and durable organizational knowledge.
- The Secretary is the root organizational coordinator. Head Council communication uses bounded agent messaging and produces a shared decision packet.
- Sentinel observes the Prime Agent family, event stream, costs, tool use, authority grants, and Maestro Goal state without becoming a worker's execution parent.
- The multi-model Overwatch Council uses separate Prime Agent subagents and, when available and approved, distinct model selectors to create genuinely independent judgments.

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

### 29. Overwatch improvement through Prime Agent refinement

- Improvement Digests feed the Overwatch Improvement Lab.
- The Lab may propose focused changes to Prime Agent continual-harness components: prompt guidance, scoped memories, reusable skills, Department Head specifications, worker templates, and narrow behavioral policies.
- `refine` is the controlled persistence mechanism for these evidence-backed changes. Refinement is not a license to rewrite the whole harness or system prompt.
- Every proposal names the observed problem, smallest relevant harness component, expected benefit, project/global scope, evaluation evidence, and rollback target.
- Initial refinement candidates remain shadow-only under the agreed staged-application policy.
- After an improvement class is explicitly enabled, eligible low-risk project-scoped refinements may apply automatically, be observed, and roll back on regression.
- Global cross-project refinements have a wider blast radius and require a separately defined authority boundary.

### Current implementation gap

This workspace contains the approved design artifacts but no Maestro application implementation. There is no legacy runtime, operational state, compatibility contract, or migration target to preserve. Implementation starts cleanly on Prime Agent's public programmatic SDK and native recursive-subagent surfaces. Existing project repositories may later be enrolled as independent source systems, but they are not Maestro legacy state.

### 30. Overwatch authority for project and bounded global refinement — proposed boundary

Overwatch should have meaningful authority to improve the Prime Agent continual harness without routing every refinement to the CEO.

- Validated project-scoped refinements may auto-apply under an enabled improvement class, with evidence, versioning, monitoring, and rollback.
- Overwatch may also auto-apply a bounded class of low-risk global refinements when all of the following hold:
  - Evidence comes from multiple relevant episodes or projects rather than one isolated outcome.
  - The change is additive or easily reversible.
  - It does not expand authority, permissions, data access, external services, model/provider scope, budget, or critical-action boundaries.
  - It has passed replay/synthetic evaluation and independent multi-model Overwatch Council review.
  - It begins with staged exposure, retains the prior version, and has measurable rollback triggers.
- Candidate bounded global changes include clearer reusable guidance, non-sensitive generalized lessons, reusable procedures or skills, capability-routing metadata, context-selection heuristics, and worker or Head templates that preserve existing authority.
- The CEO receives a grouped evidence report after application rather than a pre-approval request for every eligible refinement.
- Refinements outside this bounded class remain subject to CEO approval.

### 31. Modification and retirement of global harness entries

- Overwatch may make narrow, reversible modifications to existing global skills, memories, prompt guidance, and agent specifications when the change satisfies the bounded global-refinement evidence and safety criteria.
- Deletion, semantic reversal, broad scope expansion, or removal of an existing capability requires CEO approval.
- Apparently unused global entries are deprecated before removal. Overwatch observes actual dependency and behavior impact during the deprecation period.
- Every modification retains the prior version, reason, evidence, evaluation result, rollout scope, and rollback trigger.

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

### 34. Automatic recovery within Goal bounds

- Department Heads and the Head Council automatically retry, replace, or replan failed work within the Goal's existing cost, time, authority, and safety bounds.
- A retry requires new information, a changed hypothesis, a changed method, or a justified model, skill, environment, or worker change. Blind repetition of the same failed attempt is prohibited.
- Failed worker branch state, evidence, commands, and partial deliverables are preserved until reviewed. Useful partial commits may be retained and integrated through normal review.
- Other independent Department work continues when safe; a single worker or Department failure does not automatically cancel the Goal.
- Missing expertise may wake another existing Department under the agreed rule. Creating a new Department still requires Overwatch Council approval.
- Process or environment recovery resumes from durable Goal state and recorded Git revisions, verifies leases and enrolled-device authority, and prevents duplicate active workers before writing resumes.
- Noncritical unrecoverable failure does not interrupt the CEO mid-run. The system exhausts useful bounded alternatives, then reports the failure, attempts, evidence, preserved results, and next options.
- Critical risk follows the existing immediate CEO approval or safe-stop boundary.
- Failures, recoveries, avoided retries, and exhausted alternatives produce Improvement Digests.

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

### 40. Multi-party final certification

A Goal is reported as successful only when the required evidence authorities have completed their distinct responsibilities:

1. Each executing Department Head accepts its Department's worker outputs and integrated Department commits.
2. Quality validates the integrated Goal revision and deliverables against the launched `task.md` acceptance criteria.
3. Security and Safety & Compliance certify the relevant risk and authority criteria when the Goal requires their participation.
4. Sentinel verifies process integrity, Git lineage, required evidence, budget and authority bounds, and absence of unresolved blocking findings.
5. Sane reports success to the CEO only when all required certifications are present and bound to the same Task Contract and integrated result.

The Overwatch Council adjudicates conflicting certifications or material unresolved uncertainty; it is not a mandatory routine evaluator for every Goal. The CEO need not approve ordinary certified success. Critical push, merge, deployment, release, external publication, or other critical effects retain their separate approval gate.

### 41. Firefly external watchdog — direction under design

**Firefly** is an independent external watchdog that runs outside the main Maestro orchestration failure domain.

Purpose:

- Detect when Maestro, Prime Agent integration, an enrolled runtime, or an observed project experiences a crash, persistent health failure, functional regression, bug signal, security vulnerability, dependency exposure, or other actionable anomaly.
- Continue observing and reporting even when Maestro's primary control plane or Overwatch is unhealthy.
- Convert a detected anomaly into a bounded, evidence-backed incident signal and wake the relevant organizational expertise.

Firefly principles:

- It uses least-privilege, primarily read-only monitoring: health endpoints, bounded logs and crash summaries, approved synthetic probes, dependency or vulnerability feeds, and explicit monitored resources.
- It does not directly patch code, change production, expand authority, or spawn execution workers.
- It fingerprints and deduplicates signals, records first and last observation, confidence, severity, affected component and version, reproduction evidence when safe, and source freshness.
- Signals are signed or otherwise authenticated, freshness-checked, replay-resistant, and auditable before Maestro trusts them.
- Crash or reliability evidence maps initially to Operations and Engineering; vulnerability evidence maps to Security and Engineering; user-visible regression evidence may map to Quality, Product, Design, or Engineering as appropriate.
- Firefly creates an Incident Brief or a draft Incident Task Contract rather than injecting unbounded raw logs into Department context.
- Sane, Sentinel, and the awakened Heads receive the same incident identity so duplicate Goals and duplicate remediation are avoided.
- Firefly itself has health, credential expiry, rate, false-positive, and silence monitoring. Absence of Firefly data is not treated automatically as absence of incidents.
- Firefly findings, triage outcomes, false positives, time to detection, and remediation results feed Overwatch Improvement Digests.

### 42. Firefly triage activation and Head-to-Head calling

- For a high-confidence crash, outage, vulnerability, or comparable incident, Firefly may directly wake the relevant existing Department Heads into read-only triage mode.
- Firefly notifies Sane and Sentinel with the same authenticated incident identity at activation time.
- Lower-confidence or minor signals route first to Sane and Sentinel for correlation before waking Departments.
- Triage authority permits evidence collection, reproduction when safe, impact assessment, and an Incident Task Contract draft. It does not permit remediation writes or critical operational effects.
- Actual remediation follows the normal Task Contract, Git, worker, certification, and critical-action rules.

Department Heads may directly call other existing Department Heads:

- The calling Head provides a bounded activation brief: Goal, reason, evidence, requested contribution, urgency, relevant context, and expected budget impact.
- The called Head first joins in assessment or advisory mode and may accept ownership, provide a bounded consultation, request a Scout, or state with evidence that its Department is not relevant.
- Sane updates Council membership, context, scheduling, and budget records but is not a pre-approval gate.
- Direct calling cannot create a new Department, expand permissions, exceed the Goal ceiling, or bypass a critical-action boundary.
- Sentinel detects activation loops, duplicate Heads, unjustified expansion, and Departments that remain awake without useful contribution.

### 43. Live dashboard with milestone-based CEO reporting

- The app exposes live organizational, Council, worker, Git, budget, evaluation, Firefly, Sentinel, and Overwatch state.
- Sane keeps conversational reporting concise and milestone-based rather than narrating every worker action.
- Sane reports when the Task Contract is ready for launch, the Head Council fixes the execution direction, a material scope or forecast change occurs, a major milestone completes, or final certification succeeds or bounded recovery is exhausted.
- Critical-action approval and a severe high-confidence Firefly incident interrupt immediately.
- Routine worker spawn, completion, retry, model fallback, Scout activity, and minor replanning remain visible in the app and are grouped into the next useful milestone update.

### 44. Sane as documentation steward — direction under design

Sane is the Secretary Office's documentation authority and editorial steward.

Responsibilities:

- Maintain the canonical `task.md` and its visible amendments during initiation and execution.
- Keep a concise current project and Goal status that reflects actual control-plane, Git, budget, and certification evidence.
- Turn Head Council discussions into structured decisions with rationale, alternatives, dissent, owners, and consequences.
- Maintain Department and worker handoff packets so the receiving agent gets the required context without entire transcripts.
- Produce milestone reports, critical approval briefs, incident summaries, final outcome reports, and CEO-facing explanations.
- Keep a discoverable index of canonical project documents and distinguish current truth, navigation, status, decisions, evidence, and history.
- Link claims to source evidence, commits, evaluations, and responsible agents.
- Consolidate or supersede duplicate and stale documentation rather than continuously creating new competing files.
- Archive completed Goal material according to retention policy and promote useful lessons through the agreed knowledge process.

Sane may delegate research, drafting, or specialist sections, but remains responsible for consistency, completeness, plain language, provenance, and accurate reflection of approved decisions.

Sane must not turn a summary into a new decision. Product scope, architecture, authority, policy, or acceptance changes require the responsible decision process and are then documented by Sane.

### 45. Sane documentation authority

- Sane automatically maintains routine canonical project documentation after meaningful milestones, including current status, Task Contract amendments already decided through the proper process, Council records, handoffs, milestone reports, incident summaries, certification state, and final reports.
- Product scope, architecture, policy, authority, budget ceiling, and acceptance changes require a recorded decision by the responsible Head Council, Overwatch Council, or CEO before Sane documents them as current truth.
- Sane preserves the meaning, rationale, dissent, provenance, and effective version of the source decision and cannot create a substantive decision through summarization.
- Documentation changes use the same Git-first isolation, diff, review, and evidence model as other project changes.

### 46. Firefly monitoring and notification scope

Initial Firefly monitoring is limited to explicitly registered surfaces:

- Maestro control-plane and app health.
- Prime Agent runtime availability and heartbeat.
- Active Goal workers, leases, and abnormal silence or crash signals.
- Explicitly registered local project health endpoints.
- Approved CI results.
- Approved dependency and vulnerability advisory sources.
- Repeated crash and error fingerprints.
- Firefly's own heartbeat, credential freshness, data freshness, and observation gaps.

Notification paths:

- During normal operation, Firefly reports to the app's Incidents channel, Sane, Sentinel, and the relevant Department Heads.
- If Maestro or Prime Agent is unavailable, Firefly may use one pre-approved out-of-band emergency channel, such as a dedicated Discord emergency channel or enrolled-device desktop notification.
- The emergency message contains only the incident identity, affected system, severity and confidence, first observation, concise evidence, and safe next action.
- This pre-approval permits bounded emergency notification only. It does not grant Firefly remediation, shell execution, broader external messaging, or new-service authority.

### 47. Secretary Office is the app home

- The default app home is the Secretary Office with Sane as the primary conversational surface.
- The CEO can state an objective, continue an Overture Crew interview, review the current `task.md`, give the single launch confirmation, and receive milestone or final reports without navigating into an operations dashboard.
- Current Goal status remains visible from the home surface without overwhelming the conversation.
- Primary navigation provides Secretary Office, Task Contracts, Goals, permanent Groups and Departments, Overwatch, Firefly and Incidents, Repository and Git, environments and enrolled devices, and data or evidence views.
- The center workspace renders the selected Sane conversation, Overture activity, Head Council, Goal timeline, Department room, Git state, incident, or Overwatch improvement.
- The contextual side panel shows the selected Goal hierarchy, active Heads and workers, branches and worktrees, budget, certification, relevant context, and authority state.
- The visual direction remains spacious, legible, restrained, shadcn-based, avatar-first, and free of decorative bold weight or wide letter spacing.

### 48. Progressive disclosure of the organization

- All permanent Groups remain discoverable in navigation, but sleeping Groups are collapsed and show only identity and sleeping state.
- Active Groups expand automatically for the current Goal.
- Within an active Group, the participating Department Heads and their worker hierarchy are visible. Sleeping Departments remain visually quiet and omit execution detail.
- The contextual side panel shows only the organization participating in the selected Goal.
- A dedicated Organization view exposes the complete permanent structure, Department charters, Head identities, avatars, ten-axis profiles, current state, recent activity, and bounded Context summary.
- When a Goal closes, temporary workers terminate and the Departments return to sleeping presentation after outcome and evidence are recorded.

### 49. Pause, stop, emergency stop, and resume

- **Pause:** stops new workers and new work, brings active commands to a safe pause point, suspends enrolled-device write authority, and preserves branches, worktrees, environments, context, and resumable state.
- **Resume:** revalidates the Task Contract, base and active Git revisions, leases, environment health, device authority, budgets, and worker identity before work continues. It does not blindly restart stale processes.
- **Stop:** cancels workers, revokes active external and device grants, closes Council execution, preserves incomplete branches, commits, evidence, and useful results, and produces a Sane stop report with completed work, unfinished work, spend, side effects, and resume options. Stop does not delete results automatically.
- **Emergency stop:** blocks execution immediately where possible, revokes all write authority, prevents automatic resume, and asks Firefly and Sentinel to verify remaining processes and observed side effects. Any already completed external effect becomes an incident record.
- Deleting preserved results or evidence remains a separate critical action.

### 50. Universal Tree View with Sane at the center — direction under design

The app provides tree representations in addition to conversational and tabular views.

Primary organization and Goal tree uses a **radial layout** that grows outward from Sane:

- Sane is the fixed center node and operational hub of the canvas.
- The selected Task Contract and Goal appear as an inner halo or first radial layer around Sane rather than displacing Sane from the center.
- The next ring contains participating permanent Groups, arranged into readable angular sectors.
- Each Group sector expands outward into its selected Department Heads.
- Each Department Head expands into Scout and Execution Workers, then key deliverables, branches, evidence, or certifications on later rings as the selected mode requires.
- Multiple active Goals occupy separate sectors around Sane. The focused Goal expands while other Goals compress to status summaries.
- Sleeping Groups and Departments remain collapsed and visually quiet; active paths are emphasized without saturated decoration.
- The CEO appears as an authority anchor outside or above the operational rings with a direct relationship to Sane, while Sane remains geometrically central.
- Sentinel is represented as an observing perimeter around the active graph. Overwatch Council and Improvement Lab remain outside the execution rings with decision and refinement edges directed inward. Firefly remains outside the primary failure boundary and sends incident or wake edges toward relevant Heads.
- Cross-department Head calls and bounded worker collaboration remain hidden by default and appear as curved secondary edges only when a related node is selected.
- Labels remain upright rather than rotating around the circle. Collision handling, spacing, zoom, focus, and sector expansion prioritize legibility over fitting every node at once.

Tree modes or overlays include:

- **Organization:** Group, Department, Head, persona, state, and worker hierarchy.
- **Goal execution:** Task Contract, Council decision, Department ownership, worker missions, dependencies, milestones, and certification.
- **Git:** base revision, Goal branch, Department branches, worker branches, commits, integration, validation, and rollback lineage.
- **Context and data:** shared Goal Brief, Department Context Packs, Mission Contexts, evidence, decisions, and promoted Improvement Digests, subject to access scope.
- **Overwatch improvement:** observed signal, digest, hypothesis, candidate, evaluation, Council judgment, `refine` change, rollout, and rollback.
- **Incident:** Firefly signal, triage Heads, Incident Task Contract, remediation branches, certification, and resolution.

All tree views support collapse, zoom, filtering, search, focus on current Goal or Department, and a synchronized detail panel. They preserve the restrained shadcn-based visual direction, readable spacing, avatars, normal letter spacing, and minimal weight.

### 51. Radial Tree as an interactive control surface

- The radial tree is an operational surface, not only a visualization.
- Selecting a node opens a synchronized detail panel with identity, persona, state, mission, context summary, authority, budget, evidence, Git, environment, and related decisions appropriate to that node.
- Permitted actions include messaging Sane or a Head, opening the Task Contract or Council record, inspecting branch, commit, diff, context, evidence, cost, or certification, and using pause, stop, incident triage, avatar, or persona actions within the actor's authority.
- Controls outside the current authority are shown with a clear reason and required decision path rather than disappearing silently.
- The radial canvas, conversation, timeline, Git, and detail views remain synchronized to the same selected Goal and node identity.

### 52. Durable restart and safe resume

- A restart restores Sane, launched Task Contracts, active Goals, Council decisions, participating Groups and Departments, budgets, authority grants, certification state, and the radial-tree view from durable records.
- Recovery reconciles durable state with actual Prime Agent children, Git branches and worktrees, commits, environments, commands or processes, leases, device grants, and evidence before any write resumes.
- Work with valid completion evidence is not repeated.
- Ambiguous or stale workers enter a no-write recovery state. The system checks whether their mission is still required and prevents duplicate execution before resuming or creating a successor identity.
- Sleeping Heads restore durable identity, persona, Context Pack, and organizational memory without restoring an unnecessary execution process.
- Temporary workers are not revived merely because they existed before the restart. A still-required mission resumes through an auditable successor or recovered child binding.
- External and enrolled-device authority is revalidated and does not survive by assumption.
- The radial tree reflects reconciled reality, including recovery, orphaned, paused, or superseded nodes, rather than replaying a stale visual snapshot.

### 53. Concurrent Goals and project isolation

- Multiple Goals and projects may run concurrently within system, budget, and Department capacity.
- Each Goal has isolated Council state, context, budget, authority, environments, Git hierarchy, worker identities, evidence, and radial-tree sector.
- A persistent Department Head may participate in more than one Goal, but each participation uses a separate Goal context and does not merge transcripts or project-private data.
- Durable Department knowledge may inform multiple Goals only under the agreed project and cross-project knowledge boundaries.
- When safe concurrency capacity is exhausted, new Goals queue rather than degrading all active Goals.
- A high-confidence severe Firefly incident may preempt ordinary work under an explicit priority and safe-pause process.
- Sane coordinates portfolio priority, forecast, and CEO reporting. Overwatch observes whether concurrency harms quality, cost, latency, recovery, or context isolation and may refine bounded concurrency policy.

### 54. Overwatch and Department Heads decide portfolio priority

Goal priority, resource contention, and preemption are decided by a selective **Portfolio Council** composed of Overwatch and only the Department Heads materially affected by the competing Goals.

- Sane supplies current Goal commitments, CEO intent, deadlines, blockers, Task Contracts, forecasts, and consequences of delay, and chairs the process without unilaterally setting priority.
- Affected Department Heads independently state operational cost, dependency, interruption risk, safe pause points, and expected value from their Department perspective.
- Overwatch supplies cross-Goal evidence: severity, confidence, historical outcomes, cost, token use, quality, risk, opportunity cost, resource contention, and likely system-wide consequences.
- The Council decides ordering, concurrency, resource reallocation, pause points, and review time. The decision records evidence, dissent, confidence, and reconsideration triggers.
- A CEO-pinned Goal remains an explicit authority constraint and cannot be silently deprioritized.
- A credible immediate safety, security, or data-loss signal may trigger an automatic safe pause before deliberation. The Portfolio Council then decides the sustained response and resource plan.
- Only affected Heads are awakened. Routine Overwatch improvement work yields to active CEO Goals unless the improvement is itself required to restore safe operation.
- Sane executes the portfolio decision and reports material schedule effects to the CEO.

### 55. Continuous control plane with an optional app client

- Maestro's control plane operates continuously and is not tied to the app window or an interactive chat session.
- Closing the app does not stop launched Goals, Sane state, Overwatch observation, Firefly monitoring, durable leases, or safe remote and virtual-environment work.
- Department Heads and workers remain selectively activated and do not run merely because the control plane is online.
- Work requiring a disconnected or powered-off enrolled device pauses at the affected boundary; independent work in available environments may continue.
- Reopening the app restores current Sane conversation, Goal portfolio, radial tree, incidents, Git, budget, evidence, and certification state from reconciled durable truth.
- Severe incidents use the approved out-of-band Firefly channel. Noncritical notifications may be grouped during CEO-configured quiet hours.

### 56. Bounded autonomous work during idle capacity

When no CEO Goal needs the capacity, Overwatch may autonomously:

- Curate and analyze accumulated Improvement Digests.
- Detect recurring failure, waste, excessive context, redundant deliberation, or poor model and skill routing.
- Run replay/synthetic shadow evaluations.
- Validate candidate refinements to skills, Head specifications, worker templates, context selection, and routing.
- Revalidate stale or contradictory knowledge and observe deprecated harness entries.
- Check Firefly, control-plane, worktree, environment, lease, and durable-state health using safe bounded operations.
- Refresh project Context indexes from already authorized project data.
- Apply and report validated low-risk refinements within an enabled improvement class.

Overwatch does not invent or implement new product objectives, contact external parties, deploy, push, expand authority or budgets, add providers, or alter project intent merely because capacity is idle. Idle work has its own small budget and time bounds, yields at safe points to CEO Goals, and remains visible and auditable.

### 57. Direct replacement with a Prime Agent-native Maestro

The target architecture may replace the current standalone Maestro execution model and existing Web UI rather than preserving backward compatibility with their internal design.

- Prime Agent becomes the native execution kernel from the beginning of the replacement.
- The new Secretary Office, Group and Department hierarchy, recursive Head and worker spawning, skill and plugin assignment, continual-harness refinement, Overwatch organization, Firefly integration, Git hierarchy, data model, and radial app are designed as one coherent system.
- Existing `runner`, `spawner`, provider-routing, flat agent assumptions, and legacy Web UI interfaces are not compatibility constraints and may be retired when the replacement clears its acceptance gates.
- Verified safety properties remain requirements even when their old implementation is discarded: default-deny authority, bounded budgets, critical-action approval, immutable execution identity, lease and fencing protection, Git isolation, external receipt or evidence integrity, crash recovery, auditability, and shadow-first self-improvement.
- Replacement development still occurs in isolated Git branches and worktrees with a reversible cutover. “Direct replacement” means no obligation to preserve the old architecture, not destructive editing without evidence or rollback.
- Old code is removed only after the new system passes representative live behavior, recovery, security, data, and UI acceptance scenarios and the retained data decision below is satisfied.

### 58. Clean-slate replacement state

- The replacement imports no legacy Maestro operational state, active Goals, workers, leases, authority grants, UI state, routing state, telemetry, Council transcripts, or unverified memory.
- The new system starts with an empty operational database and no implied active execution.
- The approved hierarchical design, Sane identity and trait seed, organizational taxonomy, safety boundaries, and app direction are new-system requirements, not migrated runtime records.
- Existing project Git repositories remain independent source systems and may be enrolled into the new Maestro as fresh projects. They are not deleted as part of clearing Maestro state.
- Historical legacy data is not required for new-system behavior or evaluation. Removal at cutover follows the agreed critical deletion and reversible Git or backup process, but no compatibility or import path is required.

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

### 61. Evidence-driven persona evolution

- Sane, Department Heads, Sentinel, Council roles, and reusable worker profiles have a versioned persona with two layers:
  - **Core identity:** mission, organizational role, authority limits, truthfulness, safety boundaries, and prohibited behavior. This layer is stable and cannot be autonomously weakened or rewritten.
  - **Adaptive traits:** communication habits, delegation style, challenge intensity, review emphasis, collaboration patterns, and other bounded working preferences. This layer may improve over time.
- Persona evolution is based on Goal outcomes, Quality findings, Sentinel observations, Council dissent, user corrections, cost, delay, rework, and measured collaboration results rather than an agent's self-description alone.
- During Phase 1, Maestro records persona observations and proposes versioned changes, but does not autonomously apply them.
- Phase 4 may apply low-risk adaptive-trait changes only after replay, synthetic, and shadow evaluation shows improvement against a fixed baseline and the Overwatch Council accepts the evidence within an enabled improvement class.
- Every applied persona change records its source evidence, expected benefit, affected roles, measured result, version, and rollback trigger. A later regression automatically disables or rolls back the adaptive change within the approved improvement boundary.
- Changes to core identity, authority, safety boundaries, organization purpose, or CEO-facing policy always require explicit CEO approval. Such changes cannot be disguised as tone, efficiency, or persona optimization.
- Persona may influence how an agent communicates and works, but never what evidence exists, which authority it has, or whether a required challenge, escalation, or safety action occurs.

## Delivery Planning

The implementation plan has been reorganized as eight self-contained phase files in the `plan/` directory, from `phase1.md` through `phase8.md`. Those phase files contain the complete requirements, technical choices, work sequence, failure handling, tests, and release gates without depending on this interview document.

## Design Interview Closure

The intended organization, authority, execution, data, refinement, external monitoring, Git, UI, recovery, and acceptance behavior has been captured. The approved delivery direction is a thin end-to-end first release followed by bounded expansion. This document now defines the delivery phases, but software implementation still requires a separate explicit green light after review of the Phase 0–1 implementation-ready work plan.

## Safety Baseline

Existing safety constraints remain in force unless explicitly changed during this design interview:

- Initial autonomous improvement is replay/synthetic and shadow-only.
- No automatic changes to permissions, secrets, providers, budgets, network access, external sending, deployment, push, deletion, or policy.
- Connected services require explicit approval and least privilege.
- Production-impacting changes require human approval.
