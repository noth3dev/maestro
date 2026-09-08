# Model Pool & Automatic Routing — Design

- **Date:** 2026-09-08
- **Status:** Design agreed in interview. Phase 1 artifact implementation is reopened. No production router is enabled until the artifact and admission gates below are independently verified.
- **Scope:** Every model-consuming site in Maestro — Conversation, Overture, Head, Head Council, Department Plan, Worker, Scout, Helper, Semantic review, Encore reviewer, Metronome.
- **Premise:** Existing code may be rewritten freely. This design is not constrained by the current `MAESTRO_NATIVE_MODEL` / single-`modelPolicy` composition.

---

## 1. Objective

The user never picks a model per task. Work declares what it needs; models declare what they are good at; the router matches them.

**Posture: quality first, aggressive savings on light work.**

The reasoning that sets this posture: in Maestro, a model failure does not merely waste a model call. It wastes the deliberation, the mission bundle, the worker run, the Metronome challenge, the Encore adjudication, and the rework that follows. **Failing cheaply is usually more expensive than succeeding expensively.** Therefore the default bias is toward capability, and cost savings are taken deliberately on work that has been declared low-stakes.

---

## 2. The governing principle

One rule generates the routing decisions in this document:

> **Move automatically in the safe direction. Record and authorize movement toward lower capability or higher risk.**

The safe direction is spending more time, money, or capability while preserving the declared work requirement. The dangerous direction is allowing work to proceed below the capability requirement or hiding a higher-risk execution path.

| Decision | Safe direction | Dangerous direction |
| --- | --- | --- |
| Calculated pressure | Increase pressure or add an explicit uplift | Lower the calculated floor |
| Model eligibility | Lower local operational eligibility after evidence | Raise A-score eligibility without a human score decision |
| Operational availability | Remove an unavailable candidate automatically | Pretend an unbound or failing account is available |
| Mid-run model switch | Switch to another model that still matches the requirement | Switch below the requirement or mutate an admitted identity |
| Routing mode | Keep normal routing | Disable routing without an explicit pin/routing-off marker |

The Department Head may raise the calculated pressure, but may not lower it. The calculated pressure is always the floor. A lower-capability or higher-risk decision must be explicit, durable, and attributable.

---

## 3. Architecture — separate model and task metrics

Model metrics and task metrics are different objects. Only paired axes match directly. Task-only axes create pressure. Model-only axes filter and rank candidates.

```
MODEL SIDE
A  Capability       human-scored in model_map, 0..100, evidence required
B  Provider facts   provider-declared hard facts, not scores
C  Operations       automatically measured local corrections, model_map unchanged

TASK SIDE
D  Required ability one required level for each A axis; weakest-link matching
E  Work character   risk/reversibility/verification create pressure;
                   context/time/budget constrain B and C
```

The tag recipes combine only the eight A capability axes. `creativity` and `long-horizon` are deliberately excluded from the first closed vector. They may be added later, but are not deleted or silently substituted by another axis.

- A is expensive and stable. Changing the raw capability vector requires careful human scoring and evidence.
- Task-kind recipes are cheap. A recipe changes demand without re-scoring every model.
- Pressure-band thresholds are the cheapest operational layer. They project organizational decision rights without changing matching.

---

## 4. Model side — the pool

### 4.1 A. Capability — human-scored `model_map` vector

Every model has the following eight capability axes. Each score is an integer from `0` through `100`, and every score carries a one-line reason plus supporting evidence. A benchmark can be cited, but the final number is a Maestro judgment. A score without a reason is invalid.

| Axis | Definition | Maestro split |
| --- | --- | --- |
| `reasoning` | Multi-step reasoning and trade-off judgment | Department Head council |
| `coding` | Accurate code production | Worker |
| `verification` | Finding defects in another result | Metronome, Encore |
| `instruction-fidelity` | Doing the Task Contract and Grant, not something merely similar | Task Contract, Grant compliance |
| `tool-use` | Calling tools correctly and recovering from failure | IPython host tools |
| `long-context` | Using a long body of material effectively, not merely having a large window | Long-running workers |
| `knowledge` | Factual accuracy and breadth | Scout, research |
| `refusal-calibration` | Not stopping through over-refusal while still refusing what must be refused | Shell and file work |

`creativity` and `long-horizon` are not part of the initial vector. The former has no current model-selection case; the latter is represented by `long-context` plus `instruction-fidelity`. Future additions are append-only to the schema history and cannot remove or reinterpret these eight axes.

The initial scoring rubric for these eight axes is still a Phase 1 artifact to be written. Until a score and its evidence exist, the capability is `unproven`; an unproven model cannot satisfy a requirement merely because it is cheap or available.

### 4.2 B. Provider facts — hard filters, not scores

Provider-declared facts are never averaged into capability. They are checked as hard conditions before or alongside selection:

- context-window capacity
- input and output pricing
- authentication modes (`api-key`, `managed-subscription`, or other declared modes)
- data policy: allowed data classes, retention, training use, and region
- supported modalities
- tool-call support

The model map records the provider declaration and its provenance. A provider fact that is missing, stale, or incompatible with the Task Contract is a failed gate, not a zero score.

### 4.3 C. Operations — automatically measured local correction

Operational measurements are local and dynamic. They do not rewrite the public `model_map`:

- measured latency
- measured cost
- failure and timeout rate
- provider error rate
- current availability, including account binding

The project-private overlay may hold these observations and derived eligibility corrections. Operational observations can remove a candidate or change ranking; they cannot invent a capability score or widen authority, data policy, account binding, or exact model identity.

### 4.4 `model_map` — public baseline and ownership

`model_map` is a versioned, human-maintained baseline in the repository. It contains exact provider/model identity, the eight A scores, provider facts, profile/schema version, and per-score provenance. Every numeric capability entry must carry a concise reason and evidence reference.

`model_map` is never written automatically by routing, Encore, the Improvement Lab, or a provider observation. A machine may create a private registration or scoring proposal, but only a human commit can promote it into the baseline. The file format and initial entries are Phase 1 artifacts and are not yet claimed as complete.

### 4.5 Local overlay — project-private operations

Runtime operations land in a project-private overlay, never in `model_map`:

- `model_map` means “this model is generally like this” — public and human-owned.
- The overlay means “this provider/account/model is behaving like this in this project” — private and automatically updated only for C observations and operational eligibility.

The overlay is installation/project-scoped. A Goal receives an immutable routing snapshot of the baseline plus overlay version. Concurrent Goals may read the same overlay version but cannot mutate the overlay or each other’s snapshots.

### 4.6 Registering a new model

Concertmaster may propose a model entry in a private proposal artifact, including researched scores and evidence. It may not write or promote the public baseline. A model with no execution evidence remains `unproven` and is ineligible for requirements it cannot demonstrate. The proposal, human promotion commit, and later operational evidence remain separate provenance events.

---

## 5. Task side — demand

### 5.1 D. Required ability — paired with A

A task demand contains one required level from `0` through `100` for each of the eight A axes. Task-kind recipes compose these requirements. No recipe introduces a ninth capability axis.

Only A↔D pairs are matched:

- required `reasoning` is matched against model `reasoning`;
- required `tool-use` is matched against model `tool-use`;
- and so on for all eight axes.

The initial recipe list and each recipe's required levels are Phase 1 artifacts. They are versioned and can change through a normal PR without re-scoring the model pool.

### 5.2 E. Work character — pressure and constraints

The Department Head does not directly assign a routing tier. It records work-character inputs:

| Axis | Meaning | Routing effect |
| --- | --- | --- |
| Risk | Damage if the result is wrong | contributes to pressure |
| Reversibility | Whether the result can be undone | contributes to pressure |
| Verification attachment | Whether Metronome or Encore follows | contributes to pressure |
| Material scale | Amount of context that must be carried | constrains B and C |
| Time pressure | Allowed delay | constrains B and C |
| Budget headroom | Allowed cost | constrains B and C |

The first three create pressure:

```text
pressure_floor = f(risk, reversibility, verification_attachment)
pressure = max(pressure_floor, explicit_head_uplift)
```

`f` is continuous and monotonic in the dangerous direction. The exact function is a Phase 1 artifact, not a hidden table. The Head may add an uplift; it may never reduce `pressure_floor`. Material scale, time pressure, and budget headroom do not become capability requirements. They constrain provider facts and operational ranking instead.

### 5.3 Task kinds and pressure are separate

A task kind says what ability is required. Work character says how much selection pressure and organizational decision authority apply. A coding task can have low or high pressure; a research task can have low or high pressure. Neither is represented by a manually chosen `50/100/200` grade.

---

## 6. Matching and selection

### 6.1 Hard filters first

Provider facts B and operational state C filter candidates before capability selection:

- context capacity must cover material scale;
- pricing must fit budget headroom;
- authentication and account binding must be valid;
- data policy and region must permit the Task Contract's data;
- modalities and tool support must cover the task;
- current availability and provider health must pass.

A model that fails a hard fact is not rescued by a high A score.

### 6.2 Paired ability uses weakest-link matching

The router matches only the eight A↔D pairs. A model that scores 90 on `coding` and 30 on required `tool-use` does not pass by averaging to 60. Strength in one required axis cannot hide a shortfall in another.

Matching strictness is a smooth function of continuous `pressure`. It is not a lookup over discrete buckets. The exact strictness function and its minimum margins are Phase 1 artifacts. At every pressure, an explicit required-axis shortfall is visible in routing evidence.

### 6.3 B/C filtering and ranking

After hard filters and paired ability matching, the router ranks surviving candidates using the operational constraints and measurements: latency, cost, failure rate, provider error rate, and current availability. Higher capability is not traded against a failed hard fact. The router returns one selected provider-qualified identity before native admission.

Pressure bands do not participate in matching or ranking. They are organizational labels projected from continuous pressure and used only for approval, escalation, recording, and reporting.

---

## 7. Pressure bands and no-candidate decisions

There are four bands because Maestro has four approval layers. The band is a label over pressure, not a matching tier:

| Pressure band | Decision authority when the requirement is not met |
| --- | --- |
| Low | Automatic progress |
| Medium | Department Head |
| High | Encore Council |
| Critical | User |

The numeric thresholds for these labels are a Phase 1 artifact. They must not be used to weaken the continuous pressure function or to substitute for A↔D matching.

If no candidate meets the paired requirement and hard constraints, the routing record states the exact shortfall and projects the pressure band. The system escalates to the band authority. No provider outage, budget pressure, or convenience path may silently lower the requirement. A lower-capability or higher-risk execution requires an explicit decision at the applicable authority and is recorded as such.

The user is the final escalation layer, not the default routing operator. The Head and Encore may resolve an otherwise blocked route only within their declared authority; neither can widen native authority or replace exact admission checks.

---

## 8. Failure during execution

| Situation | Action |
| --- | --- |
| Connection error, rate limit, provider outage | Retry the same admitted model when the retry contract permits. |
| Another model still matches the same requirement | Switch automatically only through a new route decision and native admission. |
| Switching would fail A↔D matching or require lower pressure | Stop and escalate through the pressure-band authority. |

A qualifying switch is never an in-place mutation of an admitted runtime. The original invocation is terminal (`failed`, `unknown`, or `cancelled`) before the replacement executes. The replacement has a new routing decision, native admission, invocation identity, and binding/evidence record linked to the original attempt. A same-model retry may use the retry contract; a model change may not reuse the old provider binding or idempotency identity.

Automatic downgrade is forbidden. It would ask for a decision at the front gate and silently bypass it at the back gate.

---

## 9. Updating scores and operations

### 9.1 C observations — automatic and local

Latency, measured cost, failure/timeout rate, provider error rate, and availability are observations. The project-private overlay may update them automatically and use them to remove or rank candidates. Account binding changes can make a model unavailable without changing its A scores or public facts.

### 9.2 A capability judgments — human and evidence-backed

Capability scores are judgments, not telemetry. Changing an A score is expensive because it changes eligibility for every recipe and every project. A change proposal must include evidence and a one-line reason for each changed number. The final score change is a human-owned `model_map` commit; routing and operational observation never write it.

The Improvement Digest may collect execution evidence and propose a change. It cannot promote the change. Any local project-specific operational correction remains C in the overlay and must not masquerade as a universal A score.

---

## 10. User override and fixed-model mode

Direct model pinning is retained for reproducibility. A pin is considered first, but it must still pass provider facts, operational availability, and all required A↔D matching. If it fails, the result is an explicit shortfall and escalation; pinning never skips the check.

A routing-off mode exists for development and explicitly fixed host-created paths. `MAESTRO_NATIVE_MODEL` is a provider-qualified fixed-model pin/routing-off setting, not a fallback. Missing configuration, provider/account mismatch, or an identity outside the authorized candidate intersection fails before admission. Results from routing-off mode carry an explicit marker in routing/certification evidence.

During migration, the router candidate set is intersected with the Mission Bundle `approvedModels`. The selected routed identity is projected into the existing singleton `modelPolicy` and native admission independently verifies exactly one provider-qualified identity.

---

## 11. Conversation

One conversation keeps one model for its lifetime. Conversation turns are not a place for silent model upgrades. If a request exceeds what the conversation should carry, Maestro proposes promotion to a Goal, where D/E requirements, pressure, routing, and admission are durable.

This preserves prompt-cache continuity and spends high capability where decisions are made — Overture and the Head council — rather than silently upgrading a chat thread.

---

## 12. Invariants

These hold regardless of routing:

1. Routing is advisory; native admission is authoritative. A routing mistake cannot widen authority, data policy, account binding, context, or exact model identity.
2. Exactly one provider-qualified model identity is fixed at admission. Candidate sets never cross that boundary.
3. The admitted model and the model that actually served the request must match.
4. Provider facts B and operational state C are evaluated before and above A↔D fitness. A high-scoring but unbound or forbidden model is not selected.
5. An unavailable or unbound account removes the model from candidates automatically; no arbitrary substitute is allowed.
6. The router may change ranking based on C observations, but never changes A or the public B facts automatically.
7. Selection failure fails closed or escalates explicitly. It never silently lowers the requirement.
8. Routing evidence and executed identity evidence are both durable and separate.
9. Pressure-band authority is recorded for approval, escalation, and reporting; the band is not used as a matching shortcut.
10. A qualifying model switch receives a new admission and binding identity linked to the old attempt.

---

## 13. Decisions taken without asking (technical)

Per the interview contract, these are settled structural choices; numeric rubrics remain Phase 1 work:

- **Demand rides on the Mission Bundle**, reusing the existing per-unit durable record rather than adding a parallel one.
- **Eight A axes are closed for the first version:** reasoning, coding, verification, instruction-fidelity, tool-use, long-context, knowledge, and refusal-calibration. Creativity and long-horizon remain future append-only extensions.
- **Task-kind recipes compose D requirements over those eight axes only.** E work-character inputs remain separate.
- **Pressure is continuous and computed from E risk, reversibility, and verification attachment.** Material scale, time pressure, and budget headroom constrain B/C. The Head may uplift but never lower the computed floor.
- **Four pressure bands are organizational projections** for automatic, Department Head, Encore Council, and user decisions. They do not participate in matching.
- **Routing evidence needs its own store.** It cannot extend `native_execution_bindings`: that table is append-only, deliberately identity-only, and carries a database-level `CHECK` that selected equals actual. Routing rationale — A/D requirements, E inputs, pressure, band, candidate set, hard-filter rejections, profile versions, and selection rationale — belongs beside it.
- **Migration intersects `approvedModels`.** The router does not materialize the entire pool into every Mission Bundle. It chooses one identity from the authorized intersection, then native admission re-verifies it.
- **How routing is surfaced in the UI** is a presentation decision, taken later during implementation.

---

## 14. Phase 1 artifact acceptance boundary

Phase 1 is reopened for the stable routing substrate, not for automatic model selection in production yet. The first implementation must produce and independently test these artifacts in order:

1. **A-axis scoring rubric:** definitions, `0..100` scoring guidance, one-line reason requirement, evidence references, and explicit unproven semantics for the eight fixed axes.
2. **B fact schema:** context capacity, input/output pricing, authentication, data policy, modalities, and tool-call support as provider-declared hard facts.
3. **C operational overlay:** local measurements for latency, cost, failures/timeouts, provider errors, and availability/account binding without mutating `model_map`.
4. **D requirement schema and recipes:** one required level per A axis; initial task-kind recipes compose only these eight axes.
5. **E work-character schema:** risk, reversibility, verification attachment, material scale, time pressure, and budget headroom; only the first three feed pressure.
6. **Pressure function:** a continuous calculation with a Head uplift that cannot lower the calculated floor. No direct tier assignment.
7. **Pressure bands:** four labels and numeric thresholds for approval/escalation/recording/reporting only; no matching behavior.
8. **Public baseline:** a versioned human-owned `model_map` format containing exact identity, A scores with reasons/evidence, B facts, profile version, and provenance.
9. **Project overlay and snapshots:** private C observations plus immutable per-Goal routing snapshots.
10. **Routing evidence:** a separate append-only record containing A/D requirements, E inputs, pressure, band, candidates, hard-filter rejections, C observations used, profile versions, selected route, and escalation/switch links. It never replaces `native_execution_bindings`.
11. **Fixed-model migration:** explicit `MAESTRO_NATIVE_MODEL` pin/routing-off behavior, `approvedModels` intersection, singleton `modelPolicy` projection, and exact native admission tests.

The first schema slice now exists at `packages/domain/src/model-profile.ts` with focused tests in `packages/domain/src/model-profile.test.ts`. It validates the closed eight-axis vector, `0..100` scored values, one-line rationale, evidence references, explicit `unproven` entries, and own-property/sparse-input boundaries. This does not complete the human scoring rubric or create production routing.

Phase 1 does not claim a production router until each artifact has a schema/validator, focused RED/GREEN tests, and a native admission test proving routing evidence cannot widen authority, account, data-policy, context, or exact model identity.

## 15. Remaining implementation artifacts

The following concrete artifacts are intentionally still open for the Phase 1 slices:

1. A-axis scoring criteria for all eight capabilities.
2. The initial task-kind recipe list and D requirement levels.
3. The continuous pressure calculation function.
4. The four pressure-band threshold values.
5. The `model_map` file format and initial entries.
6. The local C overlay and Goal snapshot format.
7. The routing evidence schema and append-only persistence path.
8. The migration adapter from `approvedModels` / `MAESTRO_NATIVE_MODEL` to one exact native `modelPolicy`.

No implementation should fill these gaps by restoring the retired `50/100/200` grade lookup or by treating a pressure band as a matching tier.

---

## 16. Traceability — where each rule came from

| Decision | Driving reason |
| --- | --- |
| Eight fixed A axes | Keep the expensive model-scoring surface small and tied to real Maestro failure points |
| B facts are hard filters | Context, price, auth, data policy, modality, and tool support are constraints, not quality scores |
| C is local operational correction | Runtime behavior varies by account/provider/project and must not rewrite the public baseline |
| A↔D weakest-link matching | A model's strength on one required ability cannot hide a shortfall on another |
| E creates continuous pressure | Risk, reversibility, and verification determine selection strictness without inventing a manual tier |
| Head uplift only | Calculated pressure is the safety floor; lowering it would hide risk |
| Four bands are labels only | The four labels project the four organizational decision layers and do not distort matching |
| `model_map` human-owned | Every capability number needs a reason and evidence that can be reviewed in a PR |
| No automatic A-score update | A raw capability change affects every recipe and every project |
| Conversation pinned, promote instead | Prompt-cache continuity and durable Goal execution are safer than silent upgrades |
| New admission on switch | An admitted provider/model binding cannot be mutated in place |
| Routing evidence separate | Native identity binding remains exact, append-only, and independent of routing rationale |
