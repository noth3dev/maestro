# Model Pool & Automatic Routing — Design

- **Date:** 2026-09-08
- **Status:** Design agreed in interview. Not implemented. No code written.
- **Scope:** Every model-consuming site in Maestro — Conversation, Overture, Head, Head Council, Department Plan, Worker, Scout, Helper, Semantic review, Encore reviewer, Metronome.
- **Premise:** Existing code may be rewritten freely. This design is not constrained by the current `MAESTRO_NATIVE_MODEL` / single-`modelPolicy` composition.

---

## 1. Objective

The user never picks a model per task. Work declares what it needs; models declare what they are good at; the router matches them.

**Posture: quality first, aggressive savings on light work.**

The reasoning that sets this posture: in Maestro, a model failure does not merely waste a model call. It wastes the deliberation, the mission bundle, the worker run, the Metronome challenge, the Encore adjudication, and the rework that follows. **Failing cheaply is usually more expensive than succeeding expensively.** Therefore the default bias is toward capability, and cost savings are taken deliberately on work that has been declared low-stakes.

---

## 2. The governing principle

One rule generates almost every specific decision in this document:

> **Move freely in the safe direction. Move explicitly in the dangerous direction.**

The dangerous direction is always the same: *a model taking on work beyond its demonstrated ability.* Every rule below is a restatement of this.

| Axis | Safe direction (free, automatic) | Dangerous direction (explicit, recorded) |
| --- | --- | --- |
| Task grade | Raise it | Lower it |
| Model capability score | Lower it | Raise it |
| Mid-run model switch | Switch to another qualifying model | Switch to a model that fails the bar |
| Conversation | Stay at the chosen model | Silently upgrade mid-thread |

The worst outcome in the safe direction is always "we spent more money." The worst outcome in the dangerous direction is "important work was quietly done by something that could not do it."

---

## 3. Architecture — three layers

The central structural decision. Tags are **not** opaque labels; they are named recipes over a small set of primitive traits.

```
Layer 1  PRIMITIVE TRAITS        writing, reasoning, creativity, accuracy,
         (models scored here)    tool-use, long-context, speed …
                                 → small, stable, expensive to change

Layer 2  TASK KINDS              "coding"   = writing↑ accuracy↑ creativity~
         (recipes over Layer 1)  "review"   = accuracy↑ reasoning↑ creativity↓
                                 → cheap to add, no model re-scoring

Layer 3  TASKS                   one or more kinds + a grade (50/100/200)
         (assigned by Heads)
```

**Why this shape.** If task kinds were atomic tags, every new kind would require re-scoring every model in the pool against it. By making kinds *recipes*, adding a kind is writing one line; existing model scores already answer it. The cost does not vanish — it moves down to Layer 1, where adding a primitive trait genuinely does require re-scoring every model. That is the correct place for the expensive operation, because primitives change rarely and kinds change often.

**Consequence:** Layer 1 is closed and versioned. Layer 2 is open and grows by PR.

---

## 4. Model side — the pool

### 4.1 `model_map` — the public baseline

A human-maintained file in the repository. Because Maestro is open source, this file is reviewed by everyone who reads the project, not by one operator. That public visibility is what makes agent-assisted registration acceptable at all (§4.3).

Holds, per model:
- identity (provider + exact model id)
- **primitive trait scores** (Layer 1 only)
- hard facts: context capacity, auth modes, data policy, pricing
- provenance: where each score came from

`model_map` is **never** written automatically. Not by the router, not by Encore, not by the Lab. It changes only by a human commit.

### 4.2 Local overlay — per-installation corrections

Runtime learning lands here, never in `model_map`.

Rationale: a model that underperforms on *this* codebase has not necessarily underperformed in general. Merging local experience into the shared baseline would let one user's repository characteristics leak into everyone's defaults, and would make `git pull` conflict with local learning.

- `model_map` = "this model is generally like this" — human-owned, public.
- Local overlay = "in our project it behaves like this" — Encore-owned, private.

The two are layered, never merged. Pulling an updated `model_map` does not destroy local corrections; local corrections never propagate outward.

### 4.3 Registering a new model

**Concertmaster may register a new model itself**, including researching and assigning initial scores. No human approval gate on registration.

This is acceptable specifically because `model_map` is a public file under version control — a bad initial score is visible and correctable by anyone, and the score's provenance is recorded as agent-assigned.

Regardless of who registered it, a model with no execution history starts **unproven** and is not eligible for high-grade work until it has a track record. A generous initial score does not buy access to critical work; only evidence does.

---

## 5. Task side — demand

### 5.1 Where demand is declared

**At the Department Head council, during task decomposition.**

This is the correct site because the council already holds everything the demand vector needs — the Task Contract, risk assessment, budget, verification requirements — and it already produces a durable, versioned record. The requirement is therefore *declared by the accountable party*, not *guessed by a classifier*.

Each decomposed unit carries: one or more **task kinds** + one **grade**. This rides on the Mission Bundle.

### 5.2 Grade — 50 / 100 / 200

Grade is **not** a quality percentage or a workload multiplier. It is selection pressure: *how bad is it if this goes wrong?*

- **200** — must not fail.
- **100** — normal.
- **50** — failing is cheap; redo it.

Rules:
- **Raising a grade is free** — anyone, anytime, no justification. Worst case is spending more.
- **Lowering a grade is an explicit act and is recorded.** Worst case is important work quietly handled by a weak model.
- **Automatic judgment rounds up.** When the grade is ambiguous between two levels, take the higher one.

### 5.3 Kinds and grade are orthogonal

There is light coding and there is life-or-death coding. Kind says *what sort of work*; grade says *how much it matters*. They are set independently.

---

## 6. Matching

### 6.1 Weakest-link, not average

A task requiring `coding` + `tool-use` is not served by a model that scores 90 on coding and 30 on tool-use. Averaging to 60 hides exactly the deficiency that will cause the failure. **Strength in one required trait cannot compensate for deficiency in another required trait.**

### 6.2 Strictness scales with grade

| Grade | Rule |
| --- | --- |
| **200** | Every required trait must clear its bar. One shortfall disqualifies. |
| **100** | Weakest-link with a small tolerance band. |
| **50** | Relaxed toward the average; cheap failure is acceptable. |

This is the quality-first posture expressed in the matcher: the more it matters, the less the system forgives a weakness.

### 6.3 Selection

Hard conditions filter first (§12). Among survivors, grade determines how the remaining traits are weighted — high grades weight capability and reliability, low grades weight cost, latency, and availability. The result is a single model, chosen before admission.

**No candidate list ever crosses into execution.** The router collapses to exactly one model, and that identity is then fixed.

---

## 7. When nothing qualifies

With weakest-link matching and strict 200 rules, "no candidate" is a routine outcome, not an exotic one — most open-source users will have exactly one or two models bound. Pure fail-closed would make the system unusable for them; silently relaxing the bar would violate the entire posture.

**Escalate through the organization. The user is the last resort, not the first.**

```
Department Head  →  Encore Council  →  User
```

**Why the Head goes first, not Encore.** The Head assigned the score in the first place — relaxing its own requirement is its own job, not a conflict. Encore, by contrast, later *certifies the result*; if Encore pre-approved the weaker model, it would be judging an outcome it authorized. Maestro already refuses self-certification elsewhere (executing agents cannot certify themselves; Luthiery is kept out of Encore for the same reason). Routing the first decision to the Head preserves that separation and, in practice, resolves most cases without Encore ever waking.

The escalation states the concrete shortfall and the options:

> This task requires `tool-use` 70. The best registered model scores 45.
> (1) proceed anyway (2) lower the grade to 100 (3) add another model

Approval scope reuses Maestro's existing approval repetition model (single use / bounded count / session), rather than inventing a new mechanism. Whoever approved, at whatever tier, **is recorded on the certification** — a result produced below its declared bar must be identifiable as such afterward.

---

## 8. Failure during execution

| Situation | Action |
| --- | --- |
| Connection error, rate limit, provider outage | Retry the same model. This is a network problem, not a routing problem. |
| Another model still clears the bar | Switch automatically. Nothing is being relaxed, so nothing needs approval. |
| Switching would require dropping below the bar | Escalate exactly as §7. |

**Why automatic downgrade is forbidden here.** It would reopen through the back door what §7 closed at the front. If a 200-grade task has exactly one qualifying model and that model fails, permissive fallback walks quietly down to an unqualified one — asking the human at the front gate and then silently descending at the back.

The unified rule: **switch freely within the bar; stop whenever the bar must move.**

---

## 9. Score updates at runtime

Split by whether the update is an **observation** or a **judgment**.

### 9.1 Facts — applied automatically

- is this provider responding
- timeout and error rates
- measured latency and measured cost

Nobody calls these judgments. A model that has timed out ten times running is unusable *right now*, and routing around it needs no approval. These feed availability and reliability, which act as hard conditions.

### 9.2 Judgments — never applied automatically

- "this model is good/bad at reasoning"
- "drop its coding score from 80 to 60"

These are policy. Evidence produces a **proposal**, not a change.

**The container already exists:** Phase 6 Step 1's Improvement Digest is exactly this — accumulate execution evidence, produce a proposal, apply nothing. No new mechanism is needed.

### 9.3 Who applies a judgment

**The Encore Learning & Improvement Lab, under Encore.** The user is not involved.

But direction matters, and the asymmetry of §2 applies inverted:

| Direction | Authority | Reason |
| --- | --- | --- |
| **Lower** a capability score | Lab, alone, immediately | Worst case: a decent model is used less. Safe. |
| **Raise** a capability score | Lab proposes → **Encore Council approves** | A raise grants a weak model eligibility for 200-grade work. This is the §7 decision arriving through a side door. |

And in both directions: **only the local overlay moves. `model_map` never changes automatically.**

---

## 10. User override

Direct model pinning is **kept**, for a concrete open-source reason: bug reports must be reproducible. If the router always chooses, "this model produced this failure" cannot be reproduced by a contributor.

But pinning is scoped precisely:

- A pinned model is **considered first**.
- If the pinned model does not meet the task's requirement, it is treated exactly as a §7 shortfall and escalates to Head → Encore.
- **Pinning means "prefer this," never "skip the check."**

Separately, a **routing-off mode** exists for development, where everything runs on one fixed model. It must be turned on explicitly, and results produced under it carry a marker on the certification: *performed with routing disabled.*

---

## 11. Conversation

**One conversation, one model, fixed for its lifetime.**

Mid-conversation upgrading was considered and rejected. The cost argument is not the naive one — switching at turn 15 of a 20-turn thread is still cheaper than paying the expensive model for all 20 turns. The real costs are **prompt-cache loss**, which dominates long-thread economics, and a single conspicuously slow turn at the switch point.

The deeper reason is structural: **needing to upgrade mid-conversation almost always means work is being done in a conversation that should not be.** "Design this architecture" is not a conversation; it is a Goal — task.md, council, workers. Maestro already has that path.

Therefore:
- Conversations are pinned to a **cheap, light model**. Most conversations genuinely are light.
- When a request exceeds what a conversation should carry, the system proposes **promoting it to a Goal**, where the council grades it properly.
- Capable models are spent where decisions are *made* — **Overture and the Head council** — not on chat.

This also resolves the bootstrap gap: the pre-grading stages do not all need top-tier models. Only the two stages whose output every downstream worker inherits do.

---

## 12. Invariants

These hold regardless of routing:

1. Routing is **advisory**; admission is **authoritative**. A router mistake cannot weaken a boundary, because admission re-verifies independently.
2. Exactly one model identity is fixed at admission. Candidate sets never cross that boundary.
3. The admitted model and the model that actually served the request must match.
4. Authority, data policy, and account binding are evaluated **before** and **above** model fitness. A model that scores best but is not permitted is not selected.
5. A model whose provider account is not currently bound is not a candidate. Availability is dynamic — a mid-Goal logout removes candidates.
6. Fallback stays inside policy. Never outside.
7. Selection failure fails closed — never an arbitrary substitute.
8. Both the routing decision and the executed identity are recorded durably.
9. Approvals that permitted sub-bar execution are recorded on the certification.

---

## 13. Decisions taken without asking (technical)

Per the interview contract, these were settled by judgment rather than put to the user:

- **Demand rides on the Mission Bundle**, reusing the existing per-unit durable record rather than adding a parallel one.
- **Approval repetition scope reuses Maestro's existing approval model** (single / bounded / session) rather than inventing a routing-specific one.
- **Proposals reuse Improvement Digest** rather than a new evidence type.
- **Routing evidence needs its own store.** It cannot extend `native_execution_bindings`: that table is append-only, deliberately identity-only, and carries a database-level `CHECK` that selected == actual. Routing rationale — the candidate set, the scores, what was rejected and why, the grade, the profile version — belongs beside it, not inside it.
- **Terminology.** `selected_model_*` in the existing schema already means "the admitted model," constrained equal to `actual`. The router's choice needs distinct vocabulary (`routed_model`, `candidate_set`) to avoid collision.
- **How routing is surfaced in the UI** is a presentation decision, taken later during implementation.

---

## 14. Drafts to be produced

Not yet written; to be drafted before implementation:

1. **Primitive trait list** (Layer 1) — small, stable, with definitions and scoring guidance.
2. **Initial task-kind recipes** (Layer 2) — coding, review, research, planning, debugging, and so on, expressed over Layer 1.
3. **Grade allocation tables** — concrete bars and weightings for 50 / 100 / 200.
4. **`model_map` file format** and initial contents for currently supported models.
5. **Local overlay storage** and its layering rule over the baseline.
6. **Routing evidence schema.**
7. **Migration path** from `MAESTRO_NATIVE_MODEL` and the current exact-model composition: the config value becomes a pin/fallback rather than the primary path.

---

## 15. Traceability — where each rule came from

| Decision | Driving reason |
| --- | --- |
| Quality-first posture | Failure wastes the deliberation stack, not just the model call |
| Grade set at council | The council already holds contract, risk, budget, verification |
| Kinds as recipes over primitives | Adding a kind must not require re-scoring every model |
| Weakest-link matching | Strength cannot compensate for a missing required trait |
| Head before Encore | Encore certifies the result; pre-approving it is self-certification |
| No automatic downgrade on failure | It reopens the front-gate decision through the back door |
| Facts auto, judgments proposed | Observation is not policy |
| Raise needs Council, lower does not | A raise grants eligibility for critical work |
| `model_map` never auto-written | Public baseline stays human-owned; local characteristics must not leak |
| Conversation pinned, promote instead | Cache loss; and heavy work belongs in a Goal, not a chat |
| Pin is preference, not exemption | Reproducibility without a hole in the bar |
