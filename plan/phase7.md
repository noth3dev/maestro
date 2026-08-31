# Phase 7 — Full Secretary Office and Radial Control Surface

## Outcome

Deliver the complete CEO-facing application after the control plane, hierarchy, oversight, operations, portfolio, and learning behaviors are proven. The app is the preferred experience; the CLI retains operational parity. The interface displays and commands durable truth rather than simulating agents or maintaining a parallel state model.

## Product structure

Primary navigation:

- Secretary Office;
- Task Contracts;
- Goals and portfolio;
- permanent Groups and Departments;
- Overwatch and improvements;
- Firefly and incidents;
- repositories and Git;
- environments and enrolled devices;
- data, evidence, budgets, and certifications.

Default home:

- Sane conversation is primary.
- Current Goal status, critical interruptions, and next required decision remain visible without dominating the conversation.
- Draft Task Contract and the single launch confirmation are available in context.
- Milestone and final reports appear in the conversation with expandable evidence.

## Technical implementation

- Next.js 16, React 19, strict TypeScript.
- Tailwind CSS 4 and shadcn/ui primitives.
- TanStack Query for server state.
- Server-Sent Events with durable cursor reconnection.
- React Flow (`@xyflow/react`) plus `d3-hierarchy` for the radial graph.
- Playwright and axe-core for behavior and accessibility.
- PWA/browser delivery first. Do not add Electron. Evaluate Tauri only after a real native-only need exists.

The UI never writes database state directly. All actions call the same typed API as the CLI and receive accepted durable versions. Optimistic presentation may show pending state but cannot claim completion before server acceptance.

## Visual system

Use the approved Warm Earth direction:

- warm neutral page and surface layers;
- terracotta primary action;
- rust for error or high-risk emphasis;
- ochre for warning and attention;
- olive for verified positive state;
- restrained borders, shadows, and radii;
- Pretendard-first Korean typography with system fallbacks;
- normal letter spacing and minimal decorative bold weight;
- spacious, legible density rather than dashboard clutter;
- light and dark themes with equivalent status meaning.

Rebuild controls semantically. Visual prototypes do not authorize inaccessible custom checkboxes, selects, dialogs, or toasts.

## Radial organization model

Sane remains the geometric and operational center.

Rings:

1. selected Task Contract and Goal as inner halo;
2. participating permanent Groups in readable sectors;
3. selected Department Heads;
4. Scout and Execution workers;
5. deliverables, branches, evidence, and certifications when requested.

External anchors:

- CEO as authority anchor outside or above rings;
- Sentinel as observing perimeter;
- Overwatch Council and Improvement Lab outside execution rings;
- Firefly outside the primary failure boundary with incident edges inward.

Multiple Goals use separate sectors. Focused Goal expands; others compress to status summaries. Sleeping organization remains collapsed and quiet. Cross-Head and bounded worker edges appear only on selection.

Graph rules:

- labels remain upright;
- collision and spacing favor legibility over showing everything;
- zoom, pan, keyboard focus, search, filtering, collapse, and focus are supported;
- graph virtualization prevents large portfolios from blocking interaction;
- every node has a stable durable identity and current-state version;
- stale or recovering state is shown explicitly;
- graph state cannot imply an actor exists when reconciliation says otherwise.

## Tree modes

### Organization

Groups, Departments, Heads, persona, current state, active Goal participation, and temporary workers.

### Goal execution

Task Contract, Council decision, Department Plans, plan items, worker missions, dependencies, milestones, and certification.

### Git

Base revision, Goal branch, Department branches, worker branches, commits, integration, validation, rollback, and cleanup.

### Context and data

Goal Brief, Department Context Packs, Mission Contexts, evidence, decisions, knowledge promotion, freshness, and access scope.

### Overwatch improvement

Signal, Digest, hypothesis, candidate, evaluator, replay, shadow result, Council judgment, refinement, rollout, and rollback.

### Incident

Firefly signal, triage organization, Incident Task Contract, remediation plans and branches, certification, and resolution.

## Interactive actions

On authorized nodes the CEO can:

- inspect identity, role, ten-axis profile, assignment, context scope, model, skills, cost, and evidence;
- talk to Sane or a relevant Head without bypassing reporting records;
- inspect and compare Task Contract or Department Plan versions;
- pause, stop, emergency stop, or resume;
- inspect branches, commits, diffs, tests, and integration state;
- review Sentinel challenges and Council dissent;
- approve an exact critical action;
- inspect, pause, compare, or roll back adaptive persona changes;
- inspect incidents and device grants.

A UI action cannot expand authority beyond the server command. Critical confirmation displays exact action, target, Goal, expiry, expected effect, and rollback feasibility.

## Progressive disclosure

Default views show:

- Sane;
- current Goal summary;
- active Departments;
- blockers and required decisions;
- latest milestone or final report.

Expand only when the CEO asks or selects:

- worker detail;
- messages and tool events;
- full ten-axis profile;
- context lineage;
- Git and evidence trees;
- costs and forecasts;
- improvement evaluation;
- incident internals.

Do not wake an agent to display its durable profile. Inspecting history is a database query, not an agent activation.

## Ten-axis persona UI

For every persistent role:

- show identity and three most distinctive axes by default;
- show all ten values, version, task-class adjustments, and active mission overlay on expansion;
- explain expected behavior at current and proposed values;
- show evidence, protected metrics, Council result, rollout status, and rollback target;
- allow CEO edits as candidate proposals through the same evaluation pipeline;
- require explicit CEO approval for core identity changes;
- never allow a slider to change authority, safety, truth, or organizational duty.

Temporary worker profiles show derivation and expiry. Historical expired workers remain inspectable without becoming active.

## Accessibility and resilience

Meet WCAG 2.2 AA:

- semantic landmarks and headings;
- full keyboard navigation and graph alternative list/tree;
- visible focus and logical focus order;
- named icon-only buttons;
- dialog focus trapping and return;
- live-region updates for background state changes;
- non-color status cues;
- contrast in both themes;
- reduced-motion support;
- minimum hit targets;
- readable zoom and responsive layout;
- screen-reader descriptions for graph relationships.

Every radial view has a synchronized linear representation. No operation requires pointer-only graph interaction.

When live connection is lost:

- show last durable cursor and stale state clearly;
- disable actions that cannot be safely accepted;
- reconnect and replay missing events;
- never reset to an empty false state;
- never imply work stopped merely because the app closed.

## Work sequence

1. Finalize accessible tokens and production primitives from the Warm Earth direction.
2. Build global shell, navigation, Sane home, Task Contract, and current Goal summary.
3. Build reusable durable-event subscription and stale/recovery states.
4. Build Goal timeline, Department room, plans, workers, budget, authority, evidence, and certification panels.
5. Build Git, environment, device, Firefly, incident, and improvement views.
6. Build radial projection API and graph rendering with organization and Goal modes.
7. Add Git, context, improvement, and incident overlays.
8. Add node actions with exact server command and approval binding.
9. Add persona inspection, version comparison, candidate editing, and rollback views.
10. Build linear accessible alternatives and keyboard behavior.
11. Run responsive, dark/light, Korean text, large graph, stale connection, and recovery tests.
12. Compare every UI action with equivalent CLI behavior.

## Failure and edge cases

- Same event delivered twice: projection remains stable.
- Node disappears after reconciliation: animate or announce removal without leaving actionable stale controls.
- Large organization graph: virtualize and collapse; do not omit critical blockers.
- Korean or long labels collide: wrap in panels and truncate graph labels with accessible full name.
- CEO approves from stale version: server rejects and shows changed facts before retry.
- Persona candidate is edited during evaluation: create a new version and invalidate old pending decision.
- App closes during Goal: control plane continues and reconnect reconstructs state.
- SSE unavailable: fall back to bounded polling without changing truth.
- Reduced motion: replace orbital transitions with immediate or subtle fades.
- Screen reader user cannot use radial graph: synchronized tree/list provides every operation.

## Tests

1. Complete Task Contract and launch flow using keyboard only.
2. App and CLI commands produce the same state and errors.
3. Close app during active Goal, reopen, and reconstruct exact current state.
4. Disconnect SSE and replay from cursor without visual duplicate.
5. Navigate every radial node through keyboard and linear alternative.
6. Validate focus behavior for dialogs, toasts, menus, and critical confirmation.
7. Run axe-core on every primary route in light and dark themes.
8. Verify status meaning without color.
9. Render multiple Goals, sleeping Departments, Sentinel perimeter, Council, and Firefly correctly.
10. Confirm graph nodes match durable identities after restart recovery.
11. Inspect all ten axes, task overlay, evidence, and rollback.
12. Attempt to use persona editor to change authority and prove server rejection.
13. Test Korean text, 200% zoom, mobile width, and reduced motion.
14. Prove no UI-only state can certify a Goal or execute a critical action.

## Exit gate

The CEO can operate the full representative system from the Secretary Office: converse with Sane, review and launch a Task Contract, inspect Goal and Department Plans, follow radial execution and Git/evidence lineage, respond to a challenge, inspect certification, review an incident and improvement, examine and propose ten-axis changes, and pause/resume safely. Closing and reopening the app preserves truth. Every operation has CLI parity, and the complete path passes keyboard and WCAG 2.2 AA checks.

## Requirements preserved in this phase

### 43. Live dashboard with milestone-based CEO reporting

- The app exposes live organizational, Council, worker, Git, budget, evaluation, Firefly, Sentinel, and Overwatch state.
- Sane keeps conversational reporting concise and milestone-based rather than narrating every worker action.
- Sane reports when the Task Contract is ready for launch, the Head Council fixes the execution direction, a material scope or forecast change occurs, a major milestone completes, or final certification succeeds or bounded recovery is exhausted.
- Critical-action approval and a severe high-confidence Firefly incident interrupt immediately.
- Routine worker spawn, completion, retry, model fallback, Scout activity, and minor replanning remain visible in the app and are grouped into the next useful milestone update.

### 47. Secretary Office is the app home

- The default app home is the Secretary Office with Sane as the primary conversational surface.
- The CEO can state an objective, continue an Initiator Crew interview, review the current `task.md`, give the single launch confirmation, and receive milestone or final reports without navigating into an operations dashboard.
- Current Goal status remains visible from the home surface without overwhelming the conversation.
- Primary navigation provides Secretary Office, Task Contracts, Goals, permanent Groups and Departments, Overwatch, Firefly and Incidents, Repository and Git, environments and enrolled devices, and data or evidence views.
- The center workspace renders the selected Sane conversation, Initiator activity, Head Council, Goal timeline, Department room, Git state, incident, or Overwatch improvement.
- The contextual side panel shows the selected Goal hierarchy, active Heads and workers, branches and worktrees, budget, certification, relevant context, and authority state.
- The visual direction remains spacious, legible, restrained, shadcn-based, avatar-first, and free of decorative bold weight or wide letter spacing.

### 48. Progressive disclosure of the organization

- All permanent Groups remain discoverable in navigation, but sleeping Groups are collapsed and show only identity and sleeping state.
- Active Groups expand automatically for the current Goal.
- Within an active Group, the participating Department Heads and their worker hierarchy are visible. Sleeping Departments remain visually quiet and omit execution detail.
- The contextual side panel shows only the organization participating in the selected Goal.
- A dedicated Organization view exposes the complete permanent structure, Department charters, Head identities, avatars, ten-axis profiles, current state, recent activity, and bounded Context summary.
- When a Goal closes, temporary workers terminate and the Departments return to sleeping presentation after outcome and evidence are recorded.

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
