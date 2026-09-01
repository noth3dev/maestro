# Extra Architecture Specification — Vanguard & Overture

## 1. Vanguard (Rapid Response Taskforce)

### Purpose
Define **Vanguard** as the dedicated, zero-delay Rapid Response Taskforce within Maestro.
While standard Departments proceed through deliberate intake, Head Council deliberation, and worker spawning, Vanguard intervenes immediately upon detection of critical high-confidence anomalies by Firefly or Sentinel.

### Core Principles & Responsibilities
1. **Zero-Delay Trigger & Activation**
   - Activated automatically when Firefly or Sentinel detects a high-confidence severe incident (e.g., process crash, database connection loss, fencing token corruption, security boundary breach).
   - Operates without administrative delay or initial Head Council debate.

2. **The 4 Emergency Protocols**
   - **Safe Isolation:** Immediately pauses target Goal write permissions and freezes compromised sessions to contain damage.
   - **Snapshot Evidence Capture:** Captures exact in-memory state, active DB transactions, stack traces, and evidence logs within 1 millisecond.
   - **Triage Briefing:** Generates an immediate Incident Triage Brief (cause hypothesis, impact, proposed remediation) and delivers it to Sane and relevant Department Heads.
   - **Bounded Remediation / Rollback:** Applies pre-approved, safe emergency rollbacks or state restorations before handing off control to routine departmental execution.

3. **Authority Boundaries**
   - Vanguard operates strictly under pre-approved emergency protocols.
   - Cannot perform permanent deletion, payment spending, unreviewed remote git push, or un-audited state mutation.
   - Hands off control back to Sane and responsible Department Heads once immediate isolation and triage are complete.

---

## 2. Overture (Intake & Framing Crew)

### Naming Update
Formerly referred to as *Initiator Crew*, the intake and task framing team is officially designated as **Overture** (서곡 — the preliminary musical piece setting the stage before Maestro's grand execution).

### Purpose
Overture acts as the intake, interview, and task-definition crew. Operating directly under Sane (Chief of Staff), Overture receives the raw, creative vision of the Insane CEO, conducts structured `/grill-me` interviews, and codifies the vision into a single, canonical `task.md` (Task Contract).

### Core Roles
- **Overture Conversation Lead:** Conducts structured interviews with the CEO to resolve ambiguities and clarify intent.
- **Overture Task Editor:** Drafts and maintains version control for the canonical `task.md` Task Contract.
- **Overture Architecture Analyst:** Inspects the current codebase, dependency graph, and system topology.
- **Overture Security Evaluator:** Assesses risk, budget limits, and critical-action boundaries.
- **Overture Domain Specialist:** Provides domain-specific technical review (e.g., database, frontend, distributed systems).

### Deliverable
A single, versioned `task.md` containing:
- Primary objective and non-negotiable boundaries.
- Explicit acceptance/validation criteria.
- Budget, resource, and timeout quotas.
- Project-level scope definitions.
