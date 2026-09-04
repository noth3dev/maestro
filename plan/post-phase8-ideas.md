# Post-Phase 8 Ideas — Architecture Extensions

This document records the post-certification architecture as three Acts.

- **Act 1 — Foundation**: Phases 1–8 (core product) + Phases 9–10 (Luthiery, Treasury)
- **Act 2 — Flashmob**: Fast path for light tasks
- **Act 3 — Arrangement**: Certified, lineage-aware self-modification and personalization

Act N begins only after Act N−1 is certified, unless an explicit exception is recorded.

---

## Act 1 — Foundation (Phases 1–10)

Act 1 is the complete safety and capability substrate required before any fast path or self-modification layer.

It includes:

| Range | Scope |
| ----- | ----- |
| **Phases 1–8** | Durable control plane, hierarchical orchestration, certification, environments/devices, portfolio, learning lab, Concertmaster UI, hardening & release certification |
| **Phase 9** | Luthiery — Dynamic MCP & Tool Workshop |
| **Phase 10** | Autonomous Treasury & Real Capital Wallet |

All Act 1 work remains strictly bounded by the control-plane invariants:

- Separation of Powers
- Durable Evidence
- Independent Certification
- Fencing Leases
- Audit-Before-Effect

Phases 1–8 definitions remain in `plan/phase1.md` … `plan/phase8.md` and the roadmap docs.  
This section specifies only the Phase 9–10 extensions that close Act 1.

---

### 1. Luthiery — Dynamic MCP & Tool Workshop (Phase 9)

#### Overview
- **Codename**: **Luthiery (루티어리 / Luthier)**
- **Position**: Phase 9
- **Purpose**: Enable agents to safely generate, audit, run, and reuse specialized **Model Context Protocol (MCP) Servers** and tools on demand during task execution without compromising Phase 1–8 control-plane safety boundaries.

#### Core Specifications

**Governance & Separation of Powers**
- Production Ownership: Infrastructure / Operations Group (tool-manufacturing engine). MUST NOT be owned by Encore.
- Encore Auditing: Metronome monitors live executions; Phase 6 Replay Lab analyzes token inflation and queues inefficient tools for refactoring.

**Isolation & Process Lifecycle**
- Dynamic MCP daemons run exclusively inside Phase 4 Task-scoped containers.
- Process PID is bound to the Goal/Task Fencing Token Lease.
- Automatic `SIGTERM` cleanup on lease expiry or task completion.

**Security & Authority Control**
- Mandatory AST static analysis: every tool handler MUST call `AuthorizedEffectExecutor.execute()`.
- Missing authority wrappers → `SecurityBypassAttemptError`.

**Reusability & Evidence**
- Certified MCP servers stored under SHA-256 Content-Addressed Hashes in `packages/evidence` + tool registry.
- Future similar tasks reuse certified servers without regeneration.

**Performance**
- Compact token-optimized payloads.
- Idempotent call caching within lease context.
- Token-inflation tools automatically queued for compression/refactoring.

#### Synergy with Phase 6 Replay Lab

| Module | Phase 6 Replay / Synthetic Lab | Luthiery (Phase 9) |
| ------ | ------------------------------ | ------------------ |
| Primary Goal | Analyze historical evidence | Manufacture runtime MCP tools |
| Output | Prompt hints, persona updates | Executable MCP code, Zod schemas |
| Timing | Offline / post-milestone | On-demand during live execution |

---

### 2. Autonomous Treasury & Real Capital Wallet (Phase 10)

#### Overview
- **Codename**: **Autonomous Treasury (자율 재무부 및 자금 지갑)**
- **Position**: Phase 10
- **Purpose**: Embed a durable System Treasury Wallet so Maestro can autonomously pay for external APIs, cloud compute, third-party services, and Web3 interactions using pre-funded capital.

#### Core Specifications

**Pre-funded Capital Model**
- Funds are deposited by the Conductor/Operator.
- Multi-rail adapters: Web3 (USDC, ETH, Solana) + fiat (Stripe, Plaid).

**Governance**
- Owned by Operations / Finance Group (Treasury Department).
- Treasury Head allocates `Goal Spend Ceiling` during Head Council planning.

**Authority & Spending Policy**
- In-budget spend executes autonomously via `payment.spend`.
- Optional 2-step Conductor confirmation for high-value thresholds.
- Audit-Before-Spend: intent + amount recorded in PostgreSQL before any network transaction.

**Audit & Ledger**
- Signed `PaymentReceipt` (tx hash, invoice hash, fencing-token proof) emitted via durable outbox.
- Metronome continuously monitors spend velocity, unauthorized transfers, and budget leaks.

---

### Act 1 Exit Gate

Act 1 is certified only when:

1. Phases 1–8 operational exit gates are closed (including usability remediation where required).
2. Luthiery can generate, authorize, run, and reuse an MCP tool under lease-bound isolation with AST authority enforcement.
3. Treasury can complete an in-budget `payment.spend` with Audit-Before-Spend and durable `PaymentReceipt`.
4. No Act 1 component can weaken Separation of Powers, Fencing, Audit-Before-Effect, or Independent Certification.

---

## Act 2 — Flashmob (Lightweight Fast Path)

Act 2 begins only after Act 1 is certified.

**Flashmob** is Maestro’s high-speed lane for light tasks: exploration, drafts, small patches, short investigations.  
It is not a second product with different safety DNA. It is a **bounded execution profile** over the Act 1 substrate.

### Core Thesis

> Flashmob optimizes for latency and cheap iteration.  
> Maestro (full path) optimizes for durable, certified project completion.  
> Risky or high-impact work must promote from Flashmob into the full hierarchical path.

### 1. When to use Flashmob

**Allowed**
- Short research / summarization
- Draft text, plans, or code sketches
- Small, scoped patches inside an explicit path allowlist
- Single-session or short multi-step work with low blast radius

**Forbidden (must use full Maestro path)**
- Production deploy, broad deletes, credential or policy changes
- Payments / Treasury spends above Flashmob ceiling (default: deny all spend unless explicitly granted a tiny ceiling)
- Cross-project or unconstrained filesystem/network access
- Any action classified `critical` or `forbidden` under the authority model
- Work that requires Head Council deliberation or Independent Certification as a success condition

### 2. Execution Profile

| Concern | Full Maestro | Flashmob |
| ------- | ------------ | -------- |
| Intake | Overture + Task Contract + confirmation | Compact brief or direct task prompt |
| Organization | Heads, Council, Department Plans | Solo or tiny temporary crew |
| Authority | Full Mission Bundle + sealed deliberation | Pre-scoped Flashmob grant (tools, paths, time, budget) |
| Persistence | Full Goal lifecycle + certification | Lightweight run record + artifact refs (still durable) |
| Success criteria | Independent certification | Operator accept / auto-accept within policy |
| Latency target | Minutes–hours | Seconds–low minutes |

### 3. Safety Minimums (non-negotiable)

Even in Flashmob:

- Every side effect still passes `AuthorizedEffectExecutor` (no bypass).
- Audit-Before-Effect still applies.
- Fencing/lease still binds the run (shorter TTL is allowed).
- Tool/path/network allowlists are mandatory.
- Default-deny for payment, deploy, and cross-tenant access.

Flashmob may reduce *ceremony*, not *invariants*.

### 4. Promotion & Demotion

**Promotion (Flashmob → Maestro)**  
Triggers (examples):

- Scope creep beyond grant
- Repeated failure or conflict
- Need for multi-department deliberation
- Operator requests certified delivery
- Budget/time ceiling hit with remaining work

Promotion creates or attaches a real Goal / Task Contract and carries forward Flashmob artifacts as evidence inputs.

**Demotion (Maestro → Flashmob)**  
Allowed only for explicitly scoped sub-work (e.g., scout note, draft diff) under a parent Goal’s authority envelope.

### 5. Shared Substrate

Flashmob MUST reuse Act 1 cores:

- identity / project membership
- authority + audit log
- evidence store (even if bundles are smaller)
- Luthiery tools only if the Flashmob grant allows them
- Treasury only under an explicit micro-ceiling (otherwise disabled)

### 6. Product Positioning

> **Flashmob** — fast investigation, drafts, small patches  
> **Maestro** — governed project execution through certification

---

## Act 3 — Arrangement (Personalized Self-Modification)

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

| Field | Description |
| ----- | ----------- |
| `arrangementId` | Content-addressed identifier (SHA-256 of canonical payload) |
| `parentArrangementIds` | Lineage (one or more parents; empty for root) |
| `sourceEvidenceIds` | Certified Evidence Bundles that justified this Arrangement |
| `capabilityDelta` | What the system can now do better (code, UI, provider, workflow, tool) |
| `personalizationDelta` | For whom / how the system should behave differently |
| `artifactRefs` | Content-addressed snapshots of changed artifacts |
| `metrics` | Measured ΔQuality, ΔSafety, ΔCost, ΔUserFit |
| `scope` | Applicability (userId, goalClass, component set, Flashmob vs full path) |
| `rollbackPlan` | Minimal reversible instructions to restore prior state |
| `certificationId` | Independent Certification that accepted this Arrangement |
| `status` | `candidate` → `certified` → `applied` → `retired` |

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

| Aspect | Act 1 Foundation | Act 2 Flashmob | Act 3 Arrangement |
| ------ | ---------------- | -------------- | ----------------- |
| Primary focus | Safe full product + tools + capital | Fast light-task execution | Evolutionary self-modification |
| Unit of change | Phases, MCP tools, payment rails | Scoped fast runs + grants | Arrangement |
| Personalization | Minimal | Profile-lite defaults only | First-class axis |
| Self-modification depth | Tool generation (Luthiery) only | None (execution profile only) | UI, code, providers, workflows, Flashmob policy (bounded) |
| Safety posture | Builds the substrate | Uses substrate; less ceremony, same invariants | Uses substrate; never weakens it |
| Entry condition | — | Act 1 certified | Act 2 certified |

Act 2 and Act 3 never receive authority to weaken Act 1 invariants.

---

## Future Extensions Placeholder

*(Additional Act 3+ ideas will be appended here.)*