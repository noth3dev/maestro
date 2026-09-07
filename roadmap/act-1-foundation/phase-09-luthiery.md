# Act 1 — Phase 9: Luthiery

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

| Module       | Phase 6 Replay / Synthetic Lab | Luthiery (Phase 9)               |
| ------------ | ------------------------------ | -------------------------------- |
| Primary Goal | Analyze historical evidence    | Manufacture runtime MCP tools    |
| Output       | Prompt hints, persona updates  | Executable MCP code, Zod schemas |
| Timing       | Offline / post-milestone       | On-demand during live execution  |

---
