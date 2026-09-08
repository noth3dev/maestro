# Act 1 — Phase 9: Luthiery

> **Current status (2026-09-08):** Phase 9 remains future work. Phase 2's persistent IPython session and explicit local host-tool contract are the first tool surface; Luthiery is a later, separately governed dynamic MCP workshop and must not be pulled into the Phase 2 implementation.

### 1. Luthiery — Dynamic MCP & Tool Workshop (Phase 9)

#### Overview

- **Codename**: **Luthiery (루티어리 / Luthier)**
- **Position**: Phase 9
- **Purpose**: Enable agents to safely generate, audit, run, and reuse specialized **Model Context Protocol (MCP) Servers** and tools on demand during task execution without compromising Phase 1–8 control-plane safety boundaries.

#### Core Specifications

**Governance & Separation of Powers**

- Production Ownership: Infrastructure / Operations Group (tool-manufacturing engine). MUST NOT be owned by Encore.
- Encore Auditing: Metronome monitors live executions; Phase 6 Replay Lab analyzes token inflation and queues inefficient tools for refactoring.
- Boundary: Phase 9 manufactures certified MCP tools; it does not replace Phase 2's session-local IPython functions, nor does it grant authority. Every generated tool still enters the same four-level approval hierarchy and authority-backed effect path.

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

| Module       | Phase 6 Replay / Synthetic Lab | Luthiery (Phase 9)               |
| ------------ | ------------------------------ | -------------------------------- |
| Primary Goal | Analyze historical evidence    | Manufacture runtime MCP tools    |
| Output       | Prompt hints, persona updates  | Executable MCP code, Zod schemas |
| Timing       | Offline / post-milestone       | On-demand during live execution  |

## Model capability declarations for generated tools — adopted design

Luthiery-generated MCP servers and tools participate in model routing without owning the model pool or authority policy.

- Each certified tool declares the primitive capabilities it requires from a model, including tool-use, context, data handling, reliability, and any safety floor.
- The router may use those declarations when composing a task demand vector, but generated tools cannot lower grade, bypass hard filters, mutate `model_map`, or select an unapproved provider.
- Tool manufacture remains owned by Infrastructure / Operations; Encore audits the generated tool and Phase 6 evaluates token inflation and observed outcomes.
- A generated tool failure or model-tool mismatch becomes routing evidence and normal Goal evidence, not an automatic capability judgment.

### Additional Phase 9 tests and exit evidence

- A generated tool with an unmet model capability is rejected before execution.
- Tool registration cannot widen the model's authority, data boundary, or routing-off state.
- Reusing a certified tool preserves its capability declaration and routing evidence lineage.

---
