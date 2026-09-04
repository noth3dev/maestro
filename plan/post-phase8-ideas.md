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

## Act 2 — Personalized Recursive Self-Modification

Act 2 begins only after Act 1 (Phase 9–10) is certified.  
Its goal is to turn Maestro from a general orchestration system into a **user-specific, self-modifying system** that continuously adapts to the individual Conductor’s work patterns, preferences, and explicit instructions — including the ability to rewrite its own UI and codebase under strict safety boundaries.

### Core Vision
- Gradually adapt to the user’s actual work style and optimize for that user.
- Accept explicit user instructions to modify its own UI.
- Accept explicit user instructions to modify its own code (e.g., plug in a new provider).
- Treat self-modification itself as a first-class, auditable, reversible Goal.
- Never allow self-modification to touch the Phase 1–8 safety invariants.

---

### 1. Self-Modification as First-Class Goal (SMFG)

- Any user request that changes Maestro’s own code, UI, configuration, or provider set is elevated to a **Self-Modification Goal**.
- Self-Modification Goals receive a dedicated fencing lease and a restricted authority scope.
- They may never acquire permissions that would allow modification of:
  - AuthorizedEffectExecutor
  - Fencing-token / lease machinery
  - Audit-before-effect path
  - Separation-of-powers boundaries
  - Certification / Metronome logic
- All side effects occur only inside an isolated Git worktree and only through `AuthorizedEffectExecutor`.
- Final promotion to the running system requires Independent Certification + optional Conductor confirmation.
- Every accepted self-modification is recorded as an immutable Evidence Bundle and remains fully reversible.

---

### 2. Personalization Genome & Continuous Adaptation

- Every interaction and certified outcome produces **User Adaptation Evidence**.
- From this evidence a **Personalization Genome** evolves:
  - Preferred UI layouts and interaction density
  - Frequent workflows and default department weighting
  - Preferred model/provider combinations and latency/quality trade-offs
  - Autonomy level and confirmation thresholds
- The Genome is content-addressed (SHA-256) and automatically applied at the start of new Goals.
- Explicit user feedback (“keep this”, “never do that again”) is stored as Positive / Negative Evidence and immediately influences future Genome updates.
- Negative Evidence carries veto power over conflicting adaptation proposals.

---

### 3. Bounded Self-Editing Pipeline

Pipeline for code or UI self-modification:

1. User issues a self-modification instruction.
2. Overture Crew produces an immutable **Modification Contract**.
3. Required Department Heads (especially Tech, Security, Quality) deliberate via sealed submissions.
4. Scout / Execution Workers perform the change inside an isolated Git worktree.
5. Automated tests + Shadow Replay are executed.
6. Metronome issues (or withholds) Certification.
7. Conductor may be required to give final approval for high-impact changes.
8. On acceptance the change is merged, the Genome is updated, and the Causal Improvement Graph records the node.

Hard constraints:
- Only one Self-Modification Goal may be active at a time.
- All changes must be reversible by a single certified rollback Goal.
- Security-critical modules remain immutable even to Self-Modification Goals.

---

### 4. Meta-Improvement Layer

- Ordinary Goals improve task performance.
- Self-Modification Goals improve the system itself.
- **Meta-Improvement Goals** improve the *process* of self-modification (e.g., “make provider addition faster and safer”, “reduce UI-edit regression rate”).
- Meta-Improvement Goals are subject to the same Evidence → Certification → Council path and cannot relax Act-1 safety invariants.

---

### 5. Causal Improvement Graph (shared across Act 2)

All accepted improvements (personalization, UI, code, meta) become nodes in a durable Causal Improvement Graph:
- Source Evidence
- Dependencies on prior improvements
- Measured ΔQuality / ΔSafety / ΔCost / ΔUser Preference Fit
- Applicability scope (user, goal class, component)

New proposals are checked against the graph for regression risk and conflict before certification.

---

## Relationship between Act 1 and Act 2

| Aspect                    | Act 1 (Phase 9–10)              | Act 2                                      |
|---------------------------|---------------------------------|--------------------------------------------|
| Primary focus             | Safe capability expansion       | User-specific self-modification            |
| What can be changed       | Tools (MCP), spending rails     | UI, code, providers, workflows, Genome     |
| Safety posture            | Hard safety substrate           | Uses the substrate; never modifies it      |
| Personalization           | None                            | Core objective                             |
| Self-modification depth   | Tool generation only            | Full system surface (bounded)              |

Act 2 is unreachable until Act 1 is certified.  
Act 2 never receives authority to weaken Act 1 invariants.

---

## Future Extensions Placeholder

*(Additional Act 2 or later ideas will be appended here.)*