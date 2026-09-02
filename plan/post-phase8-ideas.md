# Post-Phase 8 Ideas — Luthiery & Architecture Extensions

This document records approved post-certification architectural ideas and extensions deferred beyond Phase 8.

---

## 1. Luthiery — Dynamic MCP & Tool Workshop Extension

### Overview
- **Codename**: **Luthiery (루티어리 / Luthier)**
- **Position**: Post-Phase 8 Extension (Phase 9 candidate).
- **Purpose**: Enable agents to safely generate, audit, run, and reuse specialized **Model Context Protocol (MCP) Servers** and tools on demand during task execution without compromising the Phase 1–8 core control plane safety boundaries.

---

### Core Specifications

#### 1. Governance & Separation of Powers (조직 소속 및 권한 분리)
- **Production Ownership**: Positioned under the **Infrastructure / Operations Group** as a tool-manufacturing engine. It MUST NOT be directly owned by Overwatch to prevent self-auditing conflicts of interest (Separation of Powers).
- **Overwatch Auditing**: **Sentinel** monitors live tool executions for safety breaches, while the **Phase 6 Replay Lab** analyzes offline token inflation and queues inefficient tools for Luthiery refactoring.

#### 2. Isolation & Process Lifecycle
- **Task Sandbox Execution**: Dynamic MCP daemons execute exclusively within Phase 4 Task-scoped containers/sandboxes.
- **Lease PID Binding**: The MCP daemon process PID is bound to the **Goal/Task Fencing Token Lease**.
- **Automatic Clean-up**: Upon lease expiry or task completion, the control plane terminates the process via `SIGTERM` to eliminate ghost processes and resource leaks.

#### 3. Security & Authority Control
- **AST Validation Rule**: Dynamic MCP code generation enforces a mandatory AST static analysis rule. Every tool call handler MUST explicitly invoke `AuthorizedEffectExecutor.execute()`.
- **Security Evaluator Gate**: Any generated MCP server lacking verified authority execution wrappers is rejected with a `SecurityBypassAttemptError`.

#### 4. Reusability & Evidence Persistence
- Verified and accepted MCP server code is stored in `packages/evidence` and the tool registry using **SHA-256 Content-Addressed Hashes**.
- Future tasks with identical or similar requirements reuse existing certified MCP servers directly without re-generation.

#### 5. Token & Execution Performance Optimization
- **Compact Payload Serialization**: MCP Tool responses must format outputs using token-optimized minimal schemas (removing verbose boilerplates, redundant metadata, and truncating huge payloads into evidence links).
- **Execution Caching**: Idempotent MCP Tool calls (e.g., read-only queries, AST parsing, linting) cache results within the lease context to eliminate redundant execution latency and LLM token waste.
- **Token/Performance Profiling**: Luthiery tracks total token consumption and execution latency per tool call; tools causing "Token Inflation" are automatically queued for AST-level response compression and refactoring.

---

### Relationship & Synergy with Phase 6 Replay Lab

| Module | Phase 6 Replay / Synthetic Lab | Post-Phase 8 Dynamic MCP Workshop |
| :--- | :--- | :--- |
| **Primary Goal** | Research & analyze historical milestone evidence | Manufacture executable runtime MCP tools |
| **Output Artifacts** | Prompt hints, 10-axis persona updates, offline hypotheses | Executable MCP server code, Zod schemas, tool handlers |
| **Timing** | Offline / post-milestone analysis | On-demand during live task execution |
| **Synergy** | Analyzes failed/inefficient MCP tools from the Workshop to refine generator prompts |

---

## 2. Future Extensions Placeholder

*(Additional post-Phase 8 ideas will be appended here as design interviews conclude.)*
