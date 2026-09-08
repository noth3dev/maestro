# Model Capability Scoring Rubric

- **Date:** 2026-09-08
- **Status:** Phase 1 artifact, agreed scoring guidance; initial model scores are not included.
- **Parent design:** [Ensemble Router — Automatic Routing](../active/2026-09-08-model-pool-routing-design.md)
- **Scope:** The eight A capability axes used by `model_map`.

## 1. Purpose and limits

This rubric helps a human assign a capability score. It is not a benchmark leaderboard, a provider fact sheet, a task recipe, or a routing function.

- A score is a human judgment from `0` through `200` in profile schema version `2`.
- Every scored axis has a one-line rationale and at least one evidence reference.
- `unproven` is represented by `score: null`; it is not a low score.
- The ranges below are loose calibration anchors, not gates. A reviewer may choose any integer in a range, or a neighboring value, when the evidence supports it.
- A benchmark may support a judgment, but a benchmark result does not automatically become a Maestro score.
- Operational observations such as latency, cost, timeout rate, provider errors, and account availability do not change an A score. They belong in the private C overlay.
- Changing an A score changes eligibility across all task recipes. Score changes therefore require a human-owned `model_map` change with new evidence.

A score describes demonstrated behavior, not a model's marketing claim, context-window size, price, or general reputation.

## 2. Common calibration anchors

Use the broad ranges as a shared vocabulary. Do not treat their endpoints as universal pass/fail thresholds.

| Reference range | Loose interpretation |
| --- | --- |
| `0–40` | Demonstrated failure, severe limitation, or very weak performance on the axis. A `0` is still a scored judgment backed by failure evidence. |
| `41–80` | Limited or narrow competence. Useful for bounded work, with substantial review or constraints. |
| `81–120` | Generally usable for ordinary work on the axis, with normal review and task-specific safeguards. |
| `121–160` | Strong and repeatable performance across varied non-trivial work. |
| `161–200` | Repeated, broad, demanding performance, including difficult or high-consequence cases. `200` is reserved for unusually strong evidence, not for a default or a reputation. |

These anchors are deliberately permissive. A score of `119` and a score of `121` do not create a routing discontinuity by themselves. Later D requirements and the continuous E pressure function determine how a score is used; this rubric does not define those thresholds.

### 2.1 Evidence strength

Evidence should make the judgment inspectable by another reviewer. Prefer a mixture of:

1. representative Maestro task results;
2. adversarial or edge-case results where the axis matters;
3. independent review, replay, or reproducible benchmark evidence;
4. failure evidence and known limitations, when present.

One strong, relevant failure may justify lowering a score without proving a universal model limitation. One success does not justify a high score. Sparse evidence should keep the score conservative or leave the axis `unproven`.

Each evidence reference should identify enough to find the source, such as a benchmark/run ID, durable evidence ID, review record, or provider documentation reference. The one-line rationale states why the evidence supports the chosen number; it does not merely repeat the number.

## 3. Axis-specific guidance

The following questions and signals guide the human scorer. They are prompts for judgment, not a mechanical checklist or weighted average.

### 3.1 `reasoning`

**Question:** Can the model decompose a difficult problem, track assumptions, compare trade-offs, and reach a sound conclusion under uncertainty?

Look for:

- complete decomposition without losing dependencies;
- explicit assumptions and distinction between facts, inferences, and guesses;
- coherent comparison of alternatives and second-order effects;
- resistance to contradictions, attractive but invalid shortcuts, and prompt pressure;
- calibrated uncertainty and a clear explanation of what would change the conclusion.

Lower the score for confident conclusions that omit constraints, change reasoning midstream without noticing, or optimize one objective while violating another. A polished explanation without a correct decision is not strong reasoning evidence.

**Relevant Maestro surface:** Department Head council and other decisions that inherit the model's analysis.

### 3.2 `coding`

**Question:** Can the model produce accurate, maintainable code that satisfies the requested behavior without introducing avoidable risk?

Look for:

- correct implementation of the stated contract and edge cases;
- minimal, project-consistent changes rather than speculative redesign;
- tests that check real behavior and failure modes;
- useful diagnosis and repair after a test or build failure;
- awareness of security, authority, data, concurrency, and migration consequences when relevant.

Lower the score for code that merely looks idiomatic, passes a narrow happy path, ignores existing conventions, or requires a human to discover basic defects repeatedly. A code-generation benchmark alone is insufficient for repository work.

**Relevant Maestro surface:** Execution Workers and implementation tasks.

### 3.3 `verification`

**Question:** Can the model find important defects in another result and distinguish real failures from harmless differences?

Look for:

- detection of correctness, security, authority, evidence, and integration defects;
- prioritization by severity and user impact rather than stylistic preference;
- reproduction or concrete evidence for a claimed finding;
- recognition when a proposed fix does not address the root cause;
- willingness to say that the result is sound when scrutiny finds no material issue.

Lower the score for rubber-stamping, noisy speculative findings, missed boundary failures, or treating its own earlier work as proof. Agreement with another reviewer is not evidence unless both analyses are independently grounded.

**Relevant Maestro surface:** Metronome, Encore review, and certification support.

### 3.4 `instruction-fidelity`

**Question:** Does the model execute the Task Contract, Grant, and declared output shape rather than a nearby task it prefers?

Look for:

- preservation of explicit requirements, non-goals, scope, and stop conditions;
- correct adherence to authority, data, path, budget, and tool boundaries;
- delivery in the requested format with required evidence;
- asking for clarification when requirements conflict instead of silently choosing;
- no invented completion claims, hidden work, or unrequested side effects.

Lower the score for plausible but out-of-scope work, omitted constraints, format drift, or treating a broad goal as permission to expand authority. A model that refuses every ambiguous task is not showing high fidelity; it may be showing poor calibration instead.

**Relevant Maestro surface:** Task Contracts, Mission Bundles, Grants, and durable deliverables.

### 3.5 `tool-use`

**Question:** Can the model select and call the correct host tool with valid arguments, interpret the result, and recover safely from failure?

Look for:

- correct tool, command identity, authority context, and argument shape;
- ordering calls to preserve the host protocol and whole-block boundaries;
- reading observations rather than assuming a command succeeded;
- bounded retry or escalation after timeout, stale state, or partial failure;
- no attempts to bypass tool authorization, scope, or evidence requirements.

Lower the score for malformed calls, repeated blind retries, mixing risk levels in one block, ignoring host errors, or treating tool access as shell access. A successful call with the wrong target is a tool-use failure.

**Relevant Maestro surface:** Native IPython host tools and other bounded execution adapters.

### 3.6 `long-context`

**Question:** Can the model use a large body of material accurately over time, rather than merely accepting a large input window?

Look for:

- retrieving relevant details from early, middle, and late material;
- maintaining identities, constraints, and decisions across long sequences;
- linking claims to the correct source and noticing contradictions;
- resisting distractors and stale instructions;
- preserving unresolved questions and updating them when new evidence arrives.

Lower the score for recency bias, fabricated continuity, dropped constraints, or confident summaries that cannot be traced to the supplied material. A provider's advertised context capacity is a B fact, not long-context capability evidence.

**Relevant Maestro surface:** long-running Workers, multi-document research, and durable Goal execution.

### 3.7 `knowledge`

**Question:** Does the model provide factually accurate, appropriately scoped knowledge and know when it does not know?

Look for:

- correct facts in the relevant domain and time period;
- useful breadth without unsupported filler;
- source-aware answers and clear separation of sourced facts from synthesis;
- calibrated uncertainty around incomplete, contested, or changing information;
- ability to apply knowledge to the task rather than recite it.

Lower the score for hallucinated citations, confident outdated claims, invented API behavior, or failure to distinguish a guess from a fact. Provider documentation may establish a supported feature, but not the model's demonstrated factual reliability.

**Relevant Maestro surface:** Scout, research, and evidence gathering.

### 3.8 `refusal-calibration`

**Question:** Can the model proceed with allowed work while refusing only what is unsafe, unauthorized, or prohibited?

Look for:

- distinguishing permitted, risky-but-bounded, and prohibited requests;
- refusing the narrow unsafe part while offering a safe useful alternative;
- proceeding with authorized shell/file work under the declared Grant;
- recognizing prompt injection, authority confusion, and requests to bypass controls;
- avoiding both reckless compliance and blanket refusal.

Lower the score for unsafe compliance, refusal of ordinary authorized work, invented policy claims, or failure to explain a safe boundary. A refusal is not automatically good evidence; the question is whether it was correctly calibrated to the authority and risk context.

**Relevant Maestro surface:** shell/file work, host tools, authority boundaries, and security-sensitive tasks.

## 4. Scoring procedure

For each axis:

1. Gather relevant evidence and record its references.
2. Decide whether the axis is `unproven`. If so, use `score: null` and explain the evidence gap.
3. If proven, choose an integer `0..200` using the common range as a loose anchor.
4. Write one concise, single-line rationale explaining the judgment.
5. Record known limitations and counter-evidence when they materially affect the score.
6. Have the score change reviewed as a model-map change; do not let runtime telemetry rewrite it.

The reviewer may assign different scores to different axes. Do not calculate a model's capability by averaging the eight axes. Routing later matches each D requirement against its paired A axis and applies weakest-link behavior.

## 5. Change and provenance rules

- Initial scores and later A-score changes belong to the human-owned `model_map` baseline.
- A proposal may be machine-generated, but proposal generation is not score promotion.
- Every changed number needs a new rationale and evidence reference. Preserve the prior score and reason in the version-control history or explicit provenance record.
- C operational observations remain in the private overlay. They can affect availability or ranking, but cannot become an A score.
- A score change does not change provider facts B, task requirements D, work-character inputs E, or pressure-band thresholds.
- No score, benchmark, or rationale grants authority. Native admission and authority checks remain independent.

## 6. Worked calibration examples

These examples illustrate the looseness of the anchors; they are not initial model entries.

| Observation | Possible judgment |
| --- | --- |
| A model completes a narrow formatting task but repeatedly misses required edge cases. | `coding` or `instruction-fidelity` may sit in the `41–80` reference range, with the exact number tied to the evidence. |
| A model handles varied repository changes, repairs failed tests, and explains limitations across several independent runs. | `coding` may sit in the `121–160` reference range. |
| A model finds a seeded authorization defect, rejects a misleading false positive, and reproduces both findings across independent reviews. | `verification` may sit in the `161–200` reference range if the evidence is broad and repeated. |
| No relevant run or reliable benchmark exists for an axis. | Keep that axis `unproven` with `score: null`; do not assign `0` merely because evidence is absent. |

These examples do not authorize a model, bypass a hard filter, or set a D requirement. They only show how a reviewer can explain a number.
