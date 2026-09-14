# Act 2 — Flashmob (Lightweight Fast Path)

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

| Concern          | Full Maestro                              | Flashmob                                               |
| ---------------- | ----------------------------------------- | ------------------------------------------------------ |
| Intake           | Overture + Task Contract + confirmation   | Compact brief or direct task prompt                    |
| Organization     | Heads, Council, Department Plans          | Solo or tiny temporary crew                            |
| Authority        | Full Mission Bundle + sealed deliberation | Pre-scoped Flashmob grant (tools, paths, time, budget) |
| Persistence      | Full Goal lifecycle + certification       | Lightweight run record + artifact refs (still durable) |
| Success criteria | Independent certification                 | Operator accept / auto-accept within policy            |
| Latency target   | Minutes–hours                             | Seconds–low minutes                                    |

### 3. Safety Minimums (non-negotiable)

Even in Flashmob:

- Every side effect still passes `AuthorizedEffectExecutor` (no bypass).
- Audit-Before-Effect still applies.
- Fencing/lease still binds the run (shorter TTL is allowed).
- Tool/path/network allowlists are mandatory.
- Default-deny for payment, deploy, and cross-tenant access.

Flashmob may reduce _ceremony_, not _invariants_.

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

## Act 1 dependency

Act 2 may begin only after [Act 1](../act-1-foundation/README.md) is certified.
