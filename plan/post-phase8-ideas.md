# Post-Phase 8 Ideas — Architecture Extensions

This document records approved post-certification architectural ideas and extensions deferred beyond Phase 8.

---

## Act 1 — Foundation Extensions (Phase 9–10)

Act 1 completes the core safety and capability substrate.  
All ideas in this Act remain strictly bounded by the Phase 1–8 control-plane invariants (Separation of Powers, Durable Evidence, Independent Certification, Fencing Leases, Audit-Before-Effect).

### 1. Luthiery — Dynamic MCP & Tool Workshop (Phase 9)

#### Overview
- **Codename**: **Luthiery (루티어리 / Luthier)**
- **Position**: Phase 9
- **Purpose**: Enable agents to safely generate, audit, run, and reuse specialized **Model Context Protocol (MCP) Servers** and tools on demand during task execution without compromising the Phase 1–8 core control plane safety boundaries.

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
|--------|--------------------------------|--------------------|
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

## Act 2 — Orchestration Genome & Personalized Self-Modification

Act 2 begins only after Act 1 (Phase 9–10) is certified.

Its purpose is to turn Maestro into a system that continuously adapts to a specific Conductor while remaining able to reconfigure its own UI, code, and providers — but only through a new evolutionary unit called the **Orchestration Genome**.

Self-modification is no longer an ad-hoc code edit.  
Every accepted change is a certified, content-addressed, causally tracked Genome.

### Core Thesis

> Maestro mutates only by creating, certifying, applying, crossing, or retiring **Orchestration Genomes**.  
> A Genome is the sole legal unit of system change and of user-specific adaptation.

This is the research-facing claim of Act 2:  
improvement is reified as a cryptographically fixed, lineage-aware, dual-axis evolutionary object under Separation of Powers.

---

### 1. Orchestration Genome — Definition

An **Orchestration Genome** is an immutable package that represents one verified change to the system or to its personalization state.

#### Minimum contents

| Field | Description |
|-------|-------------|
| `genomeId` | Content-addressed identifier (SHA-256 of canonical payload) |
| `parentGenomeIds` | Lineage (one or more parents; empty for root) |
| `sourceEvidenceIds` | Certified Evidence Bundles that justified this Genome |
| `capabilityDelta` | What the system can now do better (code, UI, provider, workflow, tool) |
| `personalizationDelta` | For whom / how the system should behave differently |
| `artifactRefs` | Content-addressed snapshots of changed artifacts |
| `metrics` | Measured ΔQuality, ΔSafety, ΔCost, ΔUserFit |
| `scope` | Applicability (userId, goalClass, component set) |
| `rollbackPlan` | Minimal reversible instructions to restore prior state |
| `certificationId` | Independent Certification that accepted this Genome |
| `status` | `candidate` → `certified` → `applied` → `retired` |

Once `certified`, the Genome payload is immutable.  
Any further change requires a **new** Genome.

---

### 2. Dual-Axis Design (Capability × Personalization)

Every Genome carries two explicit axes:

- **Capability axis**  
  Changes to tools, providers, workflows, code paths, UI components, performance characteristics.

- **Personalization axis**  
  Changes to layout preference, autonomy level, confirmation thresholds, default routing, communication style, etc.

Evaluation and Certification MUST score both axes separately.  
A Genome that improves capability but harms UserFit (or vice versa) can be rejected or scoped narrowly.

Most existing self-improving agents optimize only capability.  
Act 2 treats personalization as a first-class evolutionary axis.

---

### 3. Genome Lifecycle
Evidence / User Instruction
↓
Genome Proposal (candidate)
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
Live Observation → possible Retirement or Successor Genome

**Rules**
- Only one Genome application may be in progress at a time (system-wide or per user).
- Application occurs inside an isolated worktree / sandbox; promotion is atomic.
- Every applied Genome remains fully reversible via its `rollbackPlan`.
- Retirement does not delete history; it only removes the Genome from the active set.

---

### 4. Causal Improvement Graph

All Genomes form a durable directed graph:

- Nodes = Genomes
- Edges = parent → child lineage
- Annotations = measured deltas, veto reasons, scope

Before certification the system checks:
1. Regression risk against ancestor performance envelopes
2. Conflict with currently applied Genomes in overlapping scope
3. Similarity to Negative Evidence (past certified failures / user rejections)

If any check fails, Certification is denied and the reason is stored as Evidence.

---

### 5. Negative Evidence Sovereignty

- Rejected certifications, explicit user “never again” signals, and safety failures become **Negative Evidence Bundles**.
- Negative Evidence is append-only and permanent.
- Any new Genome that is semantically close to a Negative Evidence pattern MUST explain how it overcomes that failure.
- Failure to provide a satisfactory explanation results in automatic veto.

Failure is not merely a training signal; it holds structural veto power over future evolution.

---

### 6. Bounded Self-Modification Surface

Genomes may modify:
- UI modules and interaction patterns
- Provider adapters and model routing
- Workflow templates and department weighting
- Personalization parameters

Genomes may **never** modify:
- AuthorizedEffectExecutor
- Fencing-token / lease machinery
- Audit-Before-Effect path
- Separation-of-Powers boundaries
- Certification / Metronome core logic
- Negative Evidence store

These invariants remain hard-coded and outside the mutable surface even for Act 2.

---

### 7. Transplant, Crossover, and Meta-Genomes

**Transplant**  
A certified Genome may be proposed for another user or instance.  
It must still pass Shadow Replay, Negative Evidence checks, and Certification under the target scope.

**Crossover**  
Two certified Genomes may be combined into a candidate child Genome.  
The child is a new content-addressed object and requires full certification; lineage records both parents.

**Meta-Genome**  
A Genome whose capabilityDelta improves the Genome lifecycle itself  
(e.g., faster provider integration, lower UI-edit regression rate, better veto precision).  
Meta-Genomes follow the identical certification path and cannot relax Act 1 invariants.

---

### 8. Relationship between Act 1 and Act 2

| Aspect | Act 1 (Phase 9–10) | Act 2 |
|--------|---------------------|-------|
| Primary focus | Safe capability expansion | User-specific evolutionary self-modification |
| Unit of change | Tools (MCP), payment rails | Orchestration Genome |
| Personalization | None | First-class axis |
| Self-modification depth | Tool generation only | UI, code, providers, workflows (bounded) |
| Safety posture | Builds the substrate | Uses the substrate; never weakens it |

Act 2 is unreachable until Act 1 is certified.  
Act 2 never receives authority to weaken Act 1 invariants.

---

## Future Extensions Placeholder

*(Additional Act 2 or later ideas will be appended here.)*