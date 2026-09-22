# Carnegie Ensemble Router Runtime Wiring Design

**Status:** Draft for implementation review  
**Date:** 2026-09-22  
**Scope:** Carnegie Router Catalog UI and real Ensemble Router worker admission

## 1. Goal

Make the Carnegie Ensemble Router screen represent and control the real worker routing path, not only a decorative model pool.

A model enabled in the UI must become an input to the actual Ensemble Router selection. The selected provider/model identity and account binding must then flow through Native Admission to the Model Gateway. A disabled model must never be selected by Ensemble routing. If the remaining candidates cannot satisfy the task, admission must fail closed with a routing shortfall and must not silently fall back to pin mode or to another unlisted model.

## 2. Existing system facts

The repository already contains the core routing algorithm and the native execution seam:

- `packages/domain/src/routing-selector.ts` selects a `RouterCandidate` from a `RoutingWorkSnapshot`.
- `apps/control-plane/src/ensemble-admission.ts` converts that selection into `ExecutionAdmission` and routing evidence.
- `packages/persistence/src/worker/spawn.ts` invokes the admission factory before `ExecutionKernelPort.spawn()`.
- `apps/control-plane/src/native-execution-kernel.ts` calls `ModelGatewayPort.admit()` with the exact selected provider/model and account binding.
- `apps/control-plane/src/ensemble-candidate-catalog.ts` reads the human-owned model map and explicit candidate catalog.
- `packages/persistence/src/settings.ts` stores the operator model pool in `operator_settings.model_pool`.

The current gap is that the last item is only used to render and mutate Settings. It is not consumed by Ensemble admission. The current Settings model list is also based on the human-owned model map, while `/v1/models` is the live Gateway catalog. Those identities must remain exact and must not be merged by display name.

## 3. Non-goals

- Do not make live Gateway discovery invent capability scores or provider facts.
- Do not replace or silently rewrite `config/model_map.json` from the UI.
- Do not let a UI upload bypass Mission Bundle `approvedModels`, Goal overlay observations, data policy, or account binding checks.
- Do not add fallback from Ensemble mode to pin mode.
- Do not route ordinary Concertmaster conversations through the Ensemble Router.
- Do not expose provider secrets, tokens, or account credentials in Router responses or downloads.
- Do not claim that a live model is routable merely because the Gateway reports it.

## 4. Chosen architecture

### 4.1 Two catalog layers

The Router Catalog API and UI will show the union of two exact-identity sources:

1. **Human baseline** from `config/model_map.json`.
   - Supplies capability vectors, provider facts, and provenance.
   - Remains human-owned and read-only to the runtime.
2. **Live Gateway catalog** from `ModelGatewayPort.listModels()`.
   - Supplies current provider availability, auth modes, and data policy.
   - Is runtime/provider truth only; it does not become a routing candidate automatically.

The explicit candidate catalog remains the admission source for candidate identity and account binding. A row can be selected only when it is present in all required runtime sources:

```text
human model map
∩ explicit candidate catalog
∩ current Goal overlay observation
∩ Mission Bundle approvedModels
∩ operator model pool, when non-empty
```

The global catalog screen can verify only the static baseline, candidate, live, and pool layers. Goal overlay and Mission Bundle checks remain admission-time checks. A live-only row is displayed as `unprofiled` or `not a candidate`, never as admission-ready.

### 4.2 Operator pool is a runtime constraint

The existing `operator_settings.model_pool` remains the persisted operator preference and keeps its current empty-list meaning:

- empty `enabledModelRefs`: no additional restriction; all explicit candidates remain eligible
- non-empty `enabledModelRefs`: only candidates whose `modelRef` is in the list may pass selection

The pool is an additional allow-list. It can narrow a Mission Bundle but cannot expand it. It cannot override the candidate catalog, model map, Goal snapshot, provider facts, or account binding.

The authenticated operator identity must be carried explicitly into the worker admission factory. The current Head actor identity is not sufficient because it is a role/session identity, not necessarily the operator who changed Settings.

### 4.3 Fail-closed behavior

When the configured mode is `ensemble`:

- missing candidate catalog remains an admission error
- missing routing work snapshot remains an admission error
- an empty effective candidate set produces `EnsembleRoutingShortfallError`
- a pool exclusion is recorded as a structured routing rejection
- no caller-selected model is accepted
- no pin fallback is attempted

When the configured mode is `pin`, the existing pin path remains unchanged. The Router UI must show that the runtime is in pin mode and must not imply that pool changes affect pinned worker admission.

## 5. Runtime data flow

```text
Carnegie Router Catalog
  │
  ├─ GET /v1/router/catalog
  │     ├─ model_map baseline
  │     ├─ explicit candidate catalog
  │     ├─ live Gateway models
  │     ├─ operator pool
  │     └─ routing mode/status
  │
  └─ PATCH /v1/settings/model-pool
          │
          └─ operator_settings.model_pool

Head/Worker spawn
  │
  ├─ authenticated operatorId
  ├─ Mission Bundle approvedModels
  ├─ Goal routing snapshot
  ├─ model_map + candidate catalog
  ├─ operator enabledModelRefs
  └─ selectRoutedModel(...)
          │
          ├─ ExecutionAdmission.modelPolicy = [selected provider/model]
          ├─ ExecutionAdmission context.accountRef = selected account binding
          └─ RoutingEvidence.rejections includes pool exclusions
                  │
                  └─ Native Execution Kernel
                          │
                          └─ ModelGatewayPort.admit(exact identity + account)
```

## 6. Contract changes

### 6.1 Routing selection contract

Extend `RoutingSelectionRequest` with an optional `operatorEnabledModelRefs?: readonly string[]`.

Validation rules:

- absent or empty means unrestricted pool
- every value must be an exact provider/model identity
- duplicates are rejected
- the selector must reject a candidate with reason `operator model pool excludes candidate` before capability and operational checks

The selector still evaluates all explicit candidates so the resulting evidence explains both pool exclusions and ordinary hard-filter rejections.

### 6.2 Worker admission identity

Extend the internal worker admission input with:

```ts
readonly operatorId: string;
```

Pass it from the authenticated `WorkerService.spawn()` operator context through `SpawnWorkerRequest` and `spawnWorker()` to the admission factory. Do not reuse `CouncilActorContext.actorId` for this value.

### 6.3 Router catalog response

Add a dedicated contract rather than overloading `SettingsRead`:

```ts
type RouterRuntimeMode = "ensemble" | "pin";
type RouterRowState =
  | "pool-disabled"
  | "live-unavailable"
  | "unprofiled"
  | "not-a-candidate"
  | "catalog-ready";

interface RouterCatalogEntry {
  modelRef: string;
  providerId: string;
  modelId: string;
  baseline: {
    present: boolean;
    score: number | null;
    reviewedAt?: string;
  };
  live: {
    present: boolean;
    capabilities: string[];
    authModes: string[];
    regions: string[];
  };
  candidate: {
    present: boolean;
    candidateRefs: string[];
    accountBindings: string[];
  };
  inUse: boolean;
  state: RouterRowState;
}

interface RouterCatalogRead {
  mode: RouterRuntimeMode;
  active: boolean;
  status: "ready" | "inactive" | "partial";
  reason?: string;
  poolModelRefs: string[];
  entries: RouterCatalogEntry[];
}
```

`catalog-ready` means that the static model map, candidate binding, and current live catalog are present. It does not promise that a future Goal's Mission Bundle, TaskDemand, or Goal-scoped observation will accept the row. Those checks remain admission-time checks.

The response contains no secrets. Account bindings are opaque references only.

### 6.4 Safe config import/export

The downloadable operator config is deliberately limited to operator-owned routing scope:

```json
{
  "schemaVersion": 1,
  "enabledModelRefs": ["provider/model-id"]
}
```

Upload is a preview/apply flow:

1. parse strict JSON
2. reject unknown fields, duplicate refs, malformed identities, and models absent from the current model map
3. show the resulting state changes and models that are live-only or not candidates
4. apply only after explicit confirmation through an atomic bulk model-pool write

Add `PUT /v1/router/config` for the confirmed bulk write. It accepts the same strict `{ schemaVersion, enabledModelRefs }` document and replaces the operator pool in one transaction. The existing single-model `PATCH /v1/settings/model-pool` remains for row toggles and uses the same persistence validation. The UI must not implement an import by issuing a sequence of independent toggles.

Import cannot modify the human model map or candidate catalog. Candidate catalog changes remain deployment/configuration work and require the same explicit account binding and human baseline checks as today.

## 7. Backend components

### 7.1 Shared catalog composition

Create a shared Control Plane catalog composer used by both Settings and Router routes. It must:

- load the model map using the existing repository/package path fallback
- load the explicit candidate catalog through `readRoutingCandidateCatalog`
- query the live Gateway catalog when available
- read the operator pool
- derive deterministic row state
- return a clear inactive reason when candidate catalog or Gateway data is unavailable

Do not duplicate model map parsing in multiple routes.

### 7.2 Router routes

Add read-only `GET /v1/router/catalog` with the authenticated operator context.

Keep the existing `PATCH /v1/settings/model-pool` endpoint as the single-row write path for pool changes so existing Settings behavior and persistence remain compatible. Add `PUT /v1/router/config` for an atomic complete-pool replacement. The Router UI must call one of these paths, then reload `GET /v1/router/catalog`.

Add `POST /v1/router/config/validate` for upload preview. It must not mutate state.

### 7.3 Runtime composition

Inject a narrow model-pool reader into `composeExecutionServices` or the ensemble admission factory. At admission time:

1. read the operator pool using the explicit `operatorId`
2. include it in `selectRoutedModel`
3. create the native admission from the selected candidate
4. persist routing evidence after a durable native binding is recorded

The runtime must read the pool at admission time, not cache it in process memory. A changed setting therefore applies to the next worker admission without restarting the Control Plane.

## 8. Carnegie UI

Replace the current ambiguous pool presentation with a real Router Catalog page/section.

### Header

- `Ensemble Router` title
- runtime badge: `Ready`, `Partial`, `Inactive`, or `Pin mode`
- short reason text
- last-loaded state, without pretending it is a routing decision

### Controls

- search by Provider, model id, or exact modelRef
- Provider filter
- state filter
- `in use` filter
- download operator config
- upload operator config with preview and explicit apply

### Provider groups

Rows are grouped by exact `providerId`. `openai` and `openai-codex` must remain separate groups even if their display names are similar.

Columns:

- model
- baseline score/status
- live status
- candidate/account status
- in-use toggle
- router state

The toggle is disabled for rows that are not in the human baseline or explicit candidate catalog. It can narrow the pool but cannot make an unprofiled row routable.

### Empty and failure states

Show actionable messages:

- candidate catalog missing: configure candidate catalog before Ensemble worker admission
- model map missing/invalid: fix human-owned model map
- live Gateway unavailable: provider availability cannot be confirmed
- no catalog-ready rows: the current pool or live/catalog state leaves no static candidate; Goal and task requirements can still remove candidates at admission time
- pin mode: pool changes affect display only until Ensemble mode is enabled

## 9. Persistence and security

No new secret storage is required.

The existing `operator_settings.model_pool` write path must continue to validate that a model is present in the human-owned model map. The Router catalog may show live-only models, but the pool cannot contain them.

The authenticated operator context must be used for both reads and writes. The Gateway continues to receive its configured gateway operator identity, while Maestro authorization remains based on the real operator identity.

Pool state is an allow-list, never an authority grant. It cannot add tools, paths, data classes, budget, or models outside the Mission Bundle.

## 10. Test strategy and acceptance criteria

### Domain tests

- valid empty pool permits all candidates
- valid non-empty pool permits only matching model refs
- malformed and duplicate pool identities are rejected
- pool exclusions appear in routing rejections
- a pool that removes every eligible candidate fails with a routing shortfall
- pool cannot bypass approved models or pin constraints

### Persistence/control-plane tests

- operator identity reaches the admission factory unchanged
- model pool is read at admission time
- missing candidate catalog fails closed
- candidate catalog and model map mismatch remains rejected
- exact account binding reaches native admission
- routing evidence is written only after durable native binding

### API/UI tests

- catalog groups `openai` and `openai-codex` separately
- live-only models display as unprofiled and cannot be enabled
- upload preview does not mutate the database
- confirmed upload persists through the existing model-pool endpoint
- UI reflects runtime mode and inactive reasons
- toggling a model changes the next worker routing decision, not just the rendered row

### Live acceptance

With a valid local candidate catalog, valid human baseline, Goal-scoped operational overlay, and connected Gateway provider:

1. enable one of two candidates in the UI
2. spawn an Ensemble worker whose approved models include both
3. verify the selected model is the enabled candidate
4. verify `ModelGatewayPort.admit()` receives that exact model and account binding
5. disable that candidate
6. spawn again and verify it is rejected or the other enabled candidate is selected
7. verify routing evidence records the pool exclusion
8. verify no pin fallback occurred

## 11. Rollout order

1. Add domain pool constraint and tests.
2. Thread authenticated operator identity through worker admission.
3. Add shared Router catalog composition and API contracts.
4. Wire pool constraint into Ensemble admission and evidence.
5. Add Router Catalog UI and import/export preview.
6. Add a local candidate catalog fixture/configuration for acceptance tests only; do not invent production capability facts.
7. Run focused tests, Control Plane tests, Carnegie tests, build, lint, and live worker admission acceptance.

The feature is complete only when the live acceptance proves the UI toggle changes the real Gateway admission path.
