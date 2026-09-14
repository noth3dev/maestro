# Act 3 — Arrangement (Personalized Self-Modification)

Act 3 begins only after Act 2 is certified (Flashmob path proven under the same invariants).

Its purpose is to let Maestro continuously adapt to a specific Conductor and improve its own bounded surface — but only through a certified evolutionary unit called an **Arrangement**.

Self-modification is never an ad-hoc edit.
Every accepted change is a content-addressed, causally tracked, independently certified **Arrangement**.

### Core Thesis

> Maestro mutates only by creating, certifying, applying, crossing, or retiring **Arrangements**.
> An Arrangement is the sole legal unit of system change and of user-specific adaptation.

Improvement is reified as a cryptographically fixed, lineage-aware, dual-axis object under Separation of Powers.

---

### 1. Arrangement — Definition

An **Arrangement** is an immutable package that represents one verified change to the system or to its personalization state.

#### Minimum contents

| Field                  | Description                                                             |
| ---------------------- | ----------------------------------------------------------------------- |
| `arrangementId`        | Content-addressed identifier (SHA-256 of canonical payload)             |
| `parentArrangementIds` | Lineage (one or more parents; empty for root)                           |
| `sourceEvidenceIds`    | Certified Evidence Bundles that justified this Arrangement              |
| `capabilityDelta`      | What the system can now do better (code, UI, provider, workflow, tool)  |
| `personalizationDelta` | For whom / how the system should behave differently                     |
| `artifactRefs`         | Content-addressed snapshots of changed artifacts                        |
| `metrics`              | Measured ΔQuality, ΔSafety, ΔCost, ΔUserFit                             |
| `scope`                | Applicability (userId, goalClass, component set, Flashmob vs full path) |
| `rollbackPlan`         | Minimal reversible instructions to restore prior state                  |
| `certificationId`      | Independent Certification that accepted this Arrangement                |
| `status`               | `candidate` → `certified` → `applied` → `retired`                       |

Once `certified`, the Arrangement payload is immutable.
Any further change requires a **new** Arrangement.

---

### 2. Dual-Axis Design (Capability × Personalization)

Every Arrangement carries two explicit axes:

- **Capability axis**
  Tools, providers, workflows, code paths, UI components, performance characteristics (including Flashmob routing heuristics).

- **Personalization axis**
  Layout preference, autonomy level, confirmation thresholds, default routing (Flashmob vs full path), communication style, etc.

Evaluation and Certification MUST score both axes separately.
An Arrangement that improves capability but harms UserFit (or vice versa) can be rejected or scoped narrowly.

Most self-improving agents optimize only capability.
Act 3 treats personalization as a first-class evolutionary axis.

---

### 3. Arrangement Lifecycle

Evidence / User Instruction
↓
Arrangement Proposal (candidate)
↓
Shadow Replay + Metric Collection
↓
Negative-Evidence Veto Check
↓
Causal Lineage Conflict Check
↓
Independent Certification (Metronome + Encore Council)
↓
Optional Conductor Approval (high-impact scope)
↓
Apply (single active mutation at a time)
↓
Live Observation → Retirement or Successor Arrangement

**Rules**

- Only one Arrangement application may be in progress at a time (system-wide or per user).
- Application occurs inside an isolated worktree / sandbox; promotion is atomic.
- Every applied Arrangement remains fully reversible via its `rollbackPlan`.
- Retirement does not delete history; it only removes the Arrangement from the active set.

---

### 4. Causal Improvement Graph

All Arrangements form a durable directed graph:

- Nodes = Arrangements
- Edges = parent → child lineage
- Annotations = measured deltas, veto reasons, scope

Before certification the system checks:

1. Regression risk against ancestor performance envelopes
2. Conflict with currently applied Arrangements in overlapping scope
3. Similarity to Negative Evidence (past certified failures / user rejections)

If any check fails, Certification is denied and the reason is stored as Evidence.

---

### 5. Negative Evidence Sovereignty

- Rejected certifications, explicit user “never again” signals, and safety failures become **Negative Evidence Bundles**.
- Negative Evidence is append-only and permanent.
- Any new Arrangement that is semantically close to a Negative Evidence pattern MUST explain how it overcomes that failure.
- Failure to provide a satisfactory explanation results in automatic veto.

Failure is not merely a training signal; it holds structural veto power over future evolution.

---

### 6. Bounded Self-Modification Surface

Arrangements **may** modify:

- UI modules and interaction patterns
- Provider adapters and model routing
- Workflow templates and department weighting
- Flashmob eligibility heuristics and defaults
- Personalization parameters

Arrangements may **never** modify:

- `AuthorizedEffectExecutor`
- Fencing-token / lease machinery
- Audit-Before-Effect path
- Separation-of-Powers boundaries
- Certification / Metronome core logic
- Negative Evidence store
- Treasury security primitives or payment signing roots

These invariants remain hard-coded and outside the mutable surface even for Act 3.

---

### 7. Transplant, Crossover, and Meta-Arrangements

**Transplant**
A certified Arrangement may be proposed for another user or instance.
It must still pass Shadow Replay, Negative Evidence checks, and Certification under the target scope.

**Crossover**
Two certified Arrangements may be combined into a candidate child Arrangement.
The child is a new content-addressed object and requires full certification; lineage records both parents.

**Meta-Arrangement**
An Arrangement whose `capabilityDelta` improves the Arrangement lifecycle itself
(e.g., faster provider integration, lower UI-edit regression rate, better veto precision, better Flashmob↔Maestro promotion accuracy).
Meta-Arrangements follow the identical certification path and cannot relax Act 1 invariants.

---

### 8. Relationship between Acts

| Aspect                  | Act 1 Foundation                    | Act 2 Flashmob                                 | Act 3 Arrangement                                         |
| ----------------------- | ----------------------------------- | ---------------------------------------------- | --------------------------------------------------------- |
| Primary focus           | Safe full product + tools + capital | Fast light-task execution                      | Evolutionary self-modification                            |
| Unit of change          | Phases, MCP tools, payment rails    | Scoped fast runs + grants                      | Arrangement                                               |
| Personalization         | Minimal                             | Profile-lite defaults only                     | First-class axis                                          |
| Self-modification depth | Tool generation (Luthiery) only     | None (execution profile only)                  | UI, code, providers, workflows, Flashmob policy (bounded) |
| Safety posture          | Builds the substrate                | Uses substrate; less ceremony, same invariants | Uses substrate; never weakens it                          |
| Entry condition         | —                                   | Act 1 certified                                | Act 2 certified                                           |

Act 2 and Act 3 never receive authority to weaken Act 1 invariants.

---

## Future Extensions Placeholder

_(Additional Act 3+ ideas will be appended here.)_

## Act 1 and Act 2 dependency

Act 3 may begin only after [Act 2](../act-2-flashmob/README.md) is certified. Both Acts use the invariants established by [Act 1](../act-1-foundation/README.md).
