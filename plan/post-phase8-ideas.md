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

#### 1. Governance & Separation of Powers
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

## 2. Autonomous Treasury & Real Capital Wallet Extension

### Overview
- **Codename**: **Autonomous Treasury (자율 재무부 및 자금 지갑)**
- **Position**: Post-Phase 8 Extension (Phase 9/10 candidate).
- **Purpose**: Provide Maestro orchestration with native financial autonomy by embedding a durable **System Treasury Wallet**. Enables the system to autonomously pay for external APIs, cloud compute resources, third-party services, or Web3 smart contract interactions using pre-funded capital.

---

### Core Specifications

#### 1. Pre-funded Capital Model (사용자 충전식 펀딩 모델)
- **Orchestration-Owned Funds**: The wallet stores funds pre-charged/deposited by the CEO/Operator (User).
- **Multi-Rail Payment Adapters**: Supports both Web3 crypto assets (USDC, ETH, Solana smart contracts) and traditional fiat APIs (Stripe, Plaid API adapters).

#### 2. Governance & Treasury Department (재무부 소속)
- **Treasury Ownership**: Managed under the **Operations / Finance Group (Treasury Department)**.
- **Budget Allocation**: The Treasury Head allocates task-specific spending caps (`Goal Spend Ceiling`) during the Head Council planning phase.

#### 3. Authority & Multi-Tier Spending Policy (지출 권한 제어)
- **Default Autonomous Execution**: Spending within the Task Contract's approved budget executes autonomously via `payment.spend` actions.
- **Optional 2-Step Confirmation**: Operator can toggle a mandatory 2-step approval rule for high-value transactions, requiring explicit CEO authorization via `AuthorizedEffectExecutor` when thresholds are exceeded.
- **Audit-Before-Spend**: Transaction intent, recipient, and amount must be immutably recorded in PostgreSQL prior to dispatching any network payment transaction.

#### 4. Audit & Double-Entry Ledger Persistence (이중 기입 장부 영속성)
- **Durable Outbox Receipts**: Every spending transaction emits a signed `PaymentReceipt` containing transaction hashes, invoice hashes, and fencing token proofs.
- **Sentinel Financial Auditing**: **Sentinel** continuously monitors for unusual spend velocity, unauthorized address transfers, or budget leaks.

---

## 3. Future Extensions Placeholder

*(Additional post-Phase 8 architectural ideas will be appended here.)*
