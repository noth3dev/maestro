# Act 1 — Foundation

Act 1 is Maestro's safety and capability substrate. It must be certified before the Flashmob fast path or Arrangement self-modification layer can begin.

## Phases

| Phase | Scope                                                          | Document                                               |
| ----- | -------------------------------------------------------------- | ------------------------------------------------------ |
| 1     | Technical foundation and durable control plane                 | [Phase 1](phase-01-durable-control-plane.md)           |
| 2     | Secretary Office core and hierarchical execution               | [Phase 2](phase-02-hierarchical-execution.md)          |
| 3     | Encore, independent certification, and first usable release    | [Phase 3](phase-03-certification-release.md)           |
| 4     | Isolated environments, enrolled devices, and Discord incidents | [Phase 4](phase-04-environments-devices-incidents.md)  |
| 5     | Concurrent Goals and portfolio control                         | [Phase 5](phase-05-concurrent-goals-portfolio.md)      |
| 6     | Encore learning, refinement, and ten-axis adaptation           | [Phase 6](phase-06-learning-adaptation.md)             |
| 7     | Full Secretary Office and radial control surface               | [Phase 7](phase-07-secretary-office-ui.md)             |
| 8     | Full-system hardening and release certification                | [Phase 8](phase-08-hardening-release-certification.md) |
| 9     | Luthiery — dynamic MCP and tool workshop                       | [Phase 9](phase-09-luthiery.md)                        |
| 10    | Autonomous Treasury and real capital wallet                    | [Phase 10](phase-10-autonomous-treasury.md)            |

Act 1 preserves the non-negotiable invariants of Separation of Powers, Durable Evidence, Independent Certification, Fencing Leases, and Audit-Before-Effect.

## Active work

- [Act 1 execution plan](active/act1-execution.md)
- [Maestro TUI implementation plan](active/2026-09-06-maestro-tui.md)
- [Native agent backend plan](active/2026-09-07-maestro-native-agent-backend.md)
- [Native cutover record](active/2026-09-08-native-prime-removal-cutover.md)
- [Phase 5 execution slices](active/phase5-execution-slices.md)
- [Live operations ledger](active/operations/README.md)

## Design and history

- [Design specifications](specs/)
- [Legacy hierarchical orchestration design](archive/hierarchical-orchestration-design-legacy.md)

### Act 1 Exit Gate

Act 1 is certified only when:

1. Phases 1–8 operational exit gates are closed (including usability remediation where required).
2. Luthiery can generate, authorize, run, and reuse an MCP tool under lease-bound isolation with AST authority enforcement.
3. Treasury can complete an in-budget `payment.spend` with Audit-Before-Spend and durable `PaymentReceipt`.
4. No Act 1 component can weaken Separation of Powers, Fencing, Audit-Before-Effect, or Independent Certification.

---
