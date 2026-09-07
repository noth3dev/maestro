# Act 1 — Phase 10: Autonomous Treasury

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
