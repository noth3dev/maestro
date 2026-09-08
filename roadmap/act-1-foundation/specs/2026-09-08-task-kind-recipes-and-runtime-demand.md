# Task-Kind Recipes and Runtime Demand

- **Date:** 2026-09-08
- **Status:** Phase 1 artifact, static recipe and runtime demand contract.
- **Parent design:** [Model Pool & Automatic Routing](../active/2026-09-08-model-pool-routing-design.md)
- **Implementation:** `packages/domain/src/task-demand.ts`

## 1. Boundary

A task kind is not a pre-scored task. It is a reusable description of which of the eight A capabilities matter to a class of work.

The recipe is static. The numeric requirement is runtime state.

```text
static recipe                  runtime TaskDemand
----------------------------   --------------------------------
kind + axis roles              selected kinds
primary/supporting/unused     one 0..200 level per A axis
recipe rationale               Head rationale per level
                               Task Contract + Head decision refs
```

A recipe must never contain a model score, provider identity, pressure, band, budget, data policy, or authority grant.

## 2. Static recipe contract

The recipe schema is versioned independently from the model profile and the runtime demand schema.

```ts
type TaskKindAxisRole = "unused" | "supporting" | "primary";

interface TaskKindRecipe {
  schemaVersion: 1;
  kind: TaskKind;
  rationale: string;
  axisRoles: Record<CapabilityAxis, TaskKindAxisRole>;
}
```

Every recipe contains exactly the eight A axes:

- `reasoning`
- `coding`
- `verification`
- `instruction-fidelity`
- `tool-use`
- `long-context`
- `knowledge`
- `refusal-calibration`

Role meanings:

- **unused:** this kind does not introduce a direct requirement for the axis. A runtime task may still raise it when the concrete work requires it.
- **supporting:** the axis commonly contributes, but is not the defining ability of the kind.
- **primary:** the axis is central to the kind and should be considered explicitly during Head demand declaration.

When multiple kinds are selected, their roles combine by the strongest role per axis. This produces an emphasis shape only. It does not produce a numeric D vector.

## 3. Initial recipe set

The initial set is deliberately small and maps to existing Maestro work surfaces. It can grow through a normal PR without rescoring any model.

| Kind | Primary axes | Supporting axes |
| --- | --- | --- |
| `planning` | `reasoning`, `instruction-fidelity` | `long-context`, `knowledge`, `verification`, `refusal-calibration` |
| `coding` | `coding`, `instruction-fidelity` | `reasoning`, `verification`, `tool-use`, `long-context`, `refusal-calibration` |
| `verification` | `verification`, `reasoning` | `coding`, `instruction-fidelity`, `tool-use`, `long-context`, `knowledge`, `refusal-calibration` |
| `research` | `knowledge`, `long-context` | `reasoning`, `verification`, `instruction-fidelity`, `tool-use`, `refusal-calibration` |
| `debugging` | `coding`, `verification`, `reasoning`, `instruction-fidelity` | `tool-use`, `long-context`, `knowledge`, `refusal-calibration` |
| `tool-operation` | `tool-use`, `instruction-fidelity`, `refusal-calibration` | `reasoning`, `verification`, `long-context` |

Axes not listed in either column are `unused` for that recipe. This is an emphasis declaration, not permission to ignore a concrete Task Contract requirement.

## 4. Runtime D demand contract

The Head declares the actual requirement after reading the concrete Task Contract and decomposition item. The current domain contract stores that decision; it does not infer a level from natural language and it does not derive a level from the recipe alone.

```ts
interface TaskCapabilityRequirement {
  level: number;       // integer 0..200
  rationale: string;   // one line, written by the Head decision
}

interface TaskDemand {
  schemaVersion: 1;
  taskKinds: TaskKind[];
  requirements: Record<CapabilityAxis, TaskCapabilityRequirement>;
  provenance: {
    taskContractRef: string;
    headDecisionRef: string;
  };
}
```

Rules:

1. Every A axis has a runtime D level, including `0` when the work does not require that capability.
2. A level is an explicit Head decision grounded in the Task Contract, not a fixed property of the task kind.
3. Every level has a one-line rationale. `0` must explain why the axis is not required.
4. The Task Contract and Head decision references are mandatory.
5. The demand object contains no provider, model, account, B fact, C observation, pressure, band, authority grant, or execution identity.
6. A model is not selected while constructing demand. Native admission remains a later boundary.
7. Multiple kinds affect the Head's attention through their combined role shape; they do not automatically raise or lower numeric levels.

The runtime entrypoint is `declareTaskDemand`. It accepts only the selected kinds, the complete eight-axis requirement vector, and the two provenance references. It adds the demand schema version, validates the complete object, and returns a copied demand value. It does not accept a recipe, provider, model, or inferred default level. Missing requirements, empty provenance, hidden fields, and routing fields fail before the demand crosses the domain boundary.

## 5. Worked contrast

The same `coding` recipe can produce different runtime demands:

| Work item | Likely D difference |
| --- | --- |
| Reversible formatting change with tests | Lower `coding`, `verification`, and `tool-use` levels; rationale cites the bounded diff and validation. |
| Migration touching authority or durable state | Higher `coding`, `verification`, `instruction-fidelity`, and `tool-use` levels; rationale cites the irreversible or security-sensitive consequences. |

The recipe remains unchanged. The Head's runtime demand and the E work-character inputs describe the difference.

## 6. Validation and phase boundary

`packages/domain/src/task-demand.ts` validates:

- the six initial recipes and exact eight-axis role shape;
- known, unique task kinds;
- runtime D levels in the inclusive `0..200` range;
- one-line rationales and mandatory provenance;
- plain-object own-key boundaries, including hidden prototype/non-enumerable/symbol fields, standard-array task-kind boundaries, and rejection of provider/model fields;
- axis-wise role composition without producing numeric levels;
- explicit Head declaration through `declareTaskDemand`, including declaration-boundary rejection of routing fields and incomplete vectors.

This slice does **not** implement:

- a natural-language demand classifier;
- pressure calculation;
- pressure-band thresholds;
- model matching or ranking;
- B provider facts or C operations;
- router admission, pressure calculation, or routing evidence persistence. The declared `TaskDemand` is now carried by `MissionBundleSubstance`; existing persisted bundles without it must be reissued or backfilled before routing can consume them.

Those remain separate Phase 1 artifacts and must not be smuggled into the recipe contract.
