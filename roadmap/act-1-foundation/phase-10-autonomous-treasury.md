# Act 1 — Phase 10: Autonomous Treasury

> **Current status (2026-09-08):** Phase 10 remains future work. Treasury actions are Phase 4+ external capabilities and are never enabled by the Phase 2 local IPython full-access mode alone.

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

- In-budget spend executes autonomously via `payment.spend` only after Treasury is individually activated for the Goal and the approved spending policy covers the exact action.
- Full-access mode does not silently grant payment authority. The user may explicitly choose the approval scope for an activated Treasury capability; critical or ambiguous spend still escalates to user approval unless that explicit user choice authorizes the exact bounded spend class.
- Optional 2-step Conductor confirmation remains available for high-value thresholds.
- Audit-Before-Spend: intent + amount recorded in PostgreSQL before any network transaction.

**Audit & Ledger**

- Signed `PaymentReceipt` (tx hash, invoice hash, fencing-token proof) emitted via durable outbox.
- Metronome continuously monitors spend velocity, unauthorized transfers, and budget leaks.

## Model routing for Treasury work — adopted design

Treasury work uses the common model-pool contract, but model fitness never creates or expands financial authority.

- Treasury planning and payment-related tasks declare task-kind recipes, D requirements, and E work-character inputs in the Goal/Head Council record.
- Spend policy, exact amount/target, account binding, approval scope, fencing, and Audit-Before-Spend remain hard gates above model selection.
- A model must meet the declared `reasoning`, `instruction-fidelity`, `tool-use`, `verification`, and `refusal-calibration` requirements; cost savings cannot compensate for a B/authority hard-fact or A↔D shortfall.
- Provider failure may retry the same model or switch only to another model that still meets B/C and A↔D requirements. Automatic below-requirement routing is forbidden.
- Routing evidence, actual model identity, approval repetition scope, and signed `PaymentReceipt` remain linked for later certification and Phase 6 analysis.

### Additional Phase 10 tests and exit evidence

- A high-scoring but unbound or unauthorized model cannot initiate `payment.spend`.
- A below-requirement model cannot be introduced by a provider outage or cost optimization; the applicable pressure-band authority must make and record that decision.
- Payment, routing, authority, and receipt evidence reconstruct the exact model and approval path used for each spend.

---
