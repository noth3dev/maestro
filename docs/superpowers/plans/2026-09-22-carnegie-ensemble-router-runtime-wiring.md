# Carnegie Ensemble Router Runtime Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Carnegie Ensemble Router catalog control the real Ensemble Worker routing decision and prove the selected model/account reaches the Model Gateway.

**Architecture:** Keep `config/model_map.json` and the explicit candidate catalog as deployment-owned routing facts. Treat `operator_settings.model_pool` as an additional runtime allow-list, pass the authenticated operator identity through Worker admission, and apply that allow-list inside the existing domain selector. Add a read-only Router Catalog API that combines the human baseline, live Gateway catalog, candidate bindings, and pool state; add atomic pool import/export and a grouped Carnegie table that consumes those real APIs.

**Tech Stack:** TypeScript 5.9, Node 24, Fastify 5, PostgreSQL, Zod 4, Vitest 4, React 19, Electron context bridge, existing `@maestro/domain`, `@maestro/persistence`, `@maestro/contracts`, `@maestro/api-client`, and Model Gateway HTTP boundary.

**Spec:** `docs/superpowers/specs/2026-09-22-carnegie-ensemble-router-runtime-wiring-design.md`

## Global Constraints

- `config/model_map.json` remains human-owned and is never replaced by UI upload.
- Live Gateway discovery never invents capability scores or provider facts.
- `operator_settings.model_pool` is an allow-list only; it cannot expand Mission Bundle approval or authority.
- Empty `enabledModelRefs` preserves the existing meaning: all model-map models are in use.
- Ensemble mode never accepts a caller-selected model and never falls back to pin mode.
- Exact `provider/model` identity and opaque account binding must be preserved through Native Admission.
- Provider secrets and tokens must not appear in Router API responses or downloaded config.
- A live-only or unprofiled model may be displayed but cannot be enabled or selected.
- Every implementation task must add or update tests before implementation and run its focused test command before moving on.

---

## File Map

### Domain and persistence

- Modify `packages/domain/src/routing-selector.ts`: validate and apply the optional operator model allow-list and emit a structured pool rejection.
- Modify `packages/domain/src/routing-selector.test.ts`: selector allow-list, validation, and fail-closed coverage.
- Modify `packages/contracts/src/settings.ts`: add strict atomic model-pool config input/output schemas.
- Modify `packages/persistence/src/settings.ts`: expose raw enabled model refs and atomic replacement while retaining single-row updates.
- Modify `packages/persistence/src/settings.test.ts`: raw pool and bulk replacement tests.
- Modify `packages/persistence/src/worker/types.ts`: carry the authenticated operator identity into admission input.
- Modify `packages/persistence/src/worker/spawn.ts`: pass that identity to the admission factory.
- Modify `packages/persistence/src/worker.integration.test.ts`: prove the admission factory receives the real operator identity.

### Control Plane runtime and API

- Modify `apps/control-plane/src/ensemble-admission.ts`: pass operator pool refs into `selectRoutedModel`.
- Modify `apps/control-plane/src/ensemble-admission.test.ts`: verify pool restriction reaches selection and evidence.
- Modify `apps/control-plane/src/composition/execution-services.ts`: read the pool at each ensemble admission and pass it to the admission composer.
- Modify `apps/control-plane/src/worker-service.ts`: copy `operator.operatorId` into the internal spawn request.
- Modify `apps/control-plane/src/worker-service.test.ts`: verify the ensemble seam remains caller-model-free and carries operator identity through the service seam.
- Create `apps/control-plane/src/composition/model-map-source.ts`: one validated human model-map loader with the existing package/repository path fallback.
- Modify `apps/control-plane/src/composition/provider-access.ts`: use the shared model-map loader instead of maintaining a second parser.
- Create `apps/control-plane/src/composition/router-catalog.ts`: combine baseline, live Gateway models, candidate bindings, runtime mode, and operator pool into the Router Catalog response; validate upload documents without mutation.
- Create `apps/control-plane/src/composition/router-catalog.test.ts`: catalog row states, exact provider grouping, missing catalog, and upload validation.
- Create `apps/control-plane/src/routes/router.ts`: authenticated Router Catalog, config validation, and atomic config replacement routes.
- Create `apps/control-plane/src/router-route.test.ts`: route status, operator scoping, malformed input rejection, preview non-mutation, and atomic apply.
- Modify `apps/control-plane/src/routes/deps.ts`: add the narrow `RouterRouteDeps` type.
- Modify `apps/control-plane/src/server.ts`: add `RouterCatalogService`, wire it into `RouteDeps`, and register router routes.
- Modify `apps/control-plane/src/main.ts`: compose the Router Catalog service with the PostgreSQL pool, config, settings service, and model gateway.

### Contracts and renderer bridge

- Create `packages/contracts/src/router.ts`: strict Router Catalog, config, row-state, and validation schemas.
- Modify `packages/contracts/src/index.ts`: export router contracts.
- Create `packages/contracts/src/router.test.ts`: reject unknown fields, malformed model refs, duplicate refs, and secret-shaped fields.
- Create `packages/api-client/src/methods/router.ts`: typed client methods for catalog, validation, and atomic replacement.
- Modify `packages/api-client/src/client.ts`: expose the Router methods and contract types.
- Modify `packages/api-client/src/client.test.ts`: request paths, methods, bodies, and schema parsing.
- Modify `apps/carnegie/electron/apiBridge.ts`: expose Router methods to the renderer.
- Modify `apps/carnegie/electron/preload.cts`: mirror the exposed method list for the CommonJS preload.
- Modify `apps/carnegie/src/global.d.ts`: update the bridged API type through the existing `ApiClient` projection.

### Carnegie UI

- Modify `apps/carnegie/src/views/Settings.tsx`: replace the misleading model tabs with the grouped Router Catalog, runtime status, real toggles, search/filter, and import/export preview.
- Create `apps/carnegie/src/views/Settings.test.tsx`: render states, provider grouping, live-only disabling, toggle persistence, upload preview, and apply behavior.
- Modify `apps/carnegie/src/styles/components.css`: add only the table, status, filter, provider-group, and import-preview styles required by the new view.

### End-to-end acceptance

- Modify `apps/control-plane/src/native-worker-acceptance.integration.test.ts`: add an Ensemble-mode acceptance lane using a temporary exact candidate catalog and a real in-process provider/Gateway boundary.
- Create `apps/control-plane/src/router-runtime.integration.test.ts`: exercise UI-equivalent pool writes followed by real Worker admission and inspect Gateway identity/evidence.
- Create `config/ensemble-candidates.example.json`: non-secret candidate catalog documentation fixture using an exact `provider/model` identity; it is not used as a production default.

---

## Task 1: Add the operator pool constraint to the domain selector

**Files:**

- Modify: `packages/domain/src/routing-selector.ts`
- Test: `packages/domain/src/routing-selector.test.ts`

**Interfaces:**

- Consumes: existing `RoutingSelectionRequest`, `RouterCandidate`, and `selectRoutedModel()`.
- Produces: `RoutingSelectionRequest.operatorEnabledModelRefs?: readonly string[]`, with exact identity validation and `operator model pool excludes candidate` rejection records.

- [ ] **Step 1: Write failing selector tests.**

Add these cases to `describe("A/B/C routing selection")`:

```ts
it("rejects candidates outside a non-empty operator model pool", () => {
  const selected = selectRoutedModel(request({ operatorEnabledModelRefs: ["provider/fast"] }));
  expect(selected.selectedModelRef).toBe("provider/fast");
  expect(selected.rejected).toContainEqual({
    candidateRef: "strong",
    reason: "operator model pool excludes candidate",
  });
});

it("treats an empty operator model pool as unrestricted", () => {
  expect(selectRoutedModel(request({ operatorEnabledModelRefs: [] })).selectedModelRef).toBe("provider/strong");
});

it("rejects malformed and duplicate operator pool identities", () => {
  expect(() => selectRoutedModel(request({ operatorEnabledModelRefs: ["model-without-provider"] }))).toThrow(RoutingSelectionError);
  expect(() => selectRoutedModel(request({ operatorEnabledModelRefs: ["provider/fast", "provider/fast"] }))).toThrow(RoutingSelectionError);
});

it("fails closed when the operator pool removes every eligible candidate", () => {
  expect(() => selectRoutedModel(request({ operatorEnabledModelRefs: ["provider/not-in-catalog"] }))).toThrow(/No candidate satisfies/);
});
```

- [ ] **Step 2: Run the focused test and confirm it fails.**

Run:

```bash
npm test -- packages/domain/src/routing-selector.test.ts
```

Expected: TypeScript/test failure because the new request field and filtering do not exist.

- [ ] **Step 3: Implement the smallest selector change.**

In `RoutingSelectionRequest`, add the optional field. Add it to the strict allowed-key set in `assertSelectionRequest`. Validate it with `standardArray`, `modelRef`, and `uniqueStrings`. Before model-map and operational checks, reject each candidate whose `modelRef` is not in the non-empty pool with exactly `operator model pool excludes candidate`. Do not remove candidates before the loop; the rejection must remain in `RoutingSelection.rejected`.

- [ ] **Step 4: Run the focused test and domain surface checks.**

Run:

```bash
npm test -- packages/domain/src/routing-selector.test.ts packages/domain/src/surface.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the domain slice.**

```bash
git add packages/domain/src/routing-selector.ts packages/domain/src/routing-selector.test.ts
git commit -m "feat: apply operator model pool during routing selection"
```

---

## Task 2: Add atomic model-pool persistence

**Files:**

- Modify: `packages/contracts/src/settings.ts`
- Modify: `packages/persistence/src/settings.ts`
- Modify: `packages/persistence/src/index.ts`
- Test: `packages/persistence/src/settings.test.ts`

**Interfaces:**

- Consumes: current `SettingsModelPoolUpdate`, `createPostgresSettingsService()`, and `operator_settings.model_pool` JSONB.
- Produces:
  - `SettingsModelPoolConfigSchema` and `SettingsModelPoolConfig` with `{ schemaVersion: 1, enabledModelRefs: string[] }`.
  - `SettingsService.replaceModelPool(operatorId: string, input: SettingsModelPoolConfig): Promise<SettingsRead>`.
  - `readEnabledModelRefs(pool: Pool, operatorId: string): Promise<readonly string[]>`.

- [ ] **Step 1: Extend the persistence test fake and write failing tests.**

Add tests:

```ts
it("reads the raw empty pool as unrestricted", async () => {
  const pool = fakePool({ modelPool: { enabledModelRefs: [] } });
  await expect(readEnabledModelRefs(pool, "operator-1")).resolves.toEqual([]);
});

it("replaces the model pool atomically and sorts refs", async () => {
  const pool = fakePool();
  const service = createPostgresSettingsService({ pool, models: { list: async () => models } });
  await service.replaceModelPool("operator-1", { schemaVersion: 1, enabledModelRefs: ["model-b", "model-a"] });
  const update = pool.queries.find((entry) => entry.sql.startsWith("UPDATE operator_settings SET model_pool"));
  expect(JSON.parse(String(update?.values?.[1]))).toEqual({ enabledModelRefs: ["model-a", "model-b"] });
});

it("rejects atomic replacement refs outside the human model map", async () => {
  const service = createPostgresSettingsService({ pool: fakePool(), models: { list: async () => models } });
  await expect(service.replaceModelPool("operator-1", { schemaVersion: 1, enabledModelRefs: ["model-zzz"] })).rejects.toThrow(
    "model is not present in the human-owned model_map",
  );
});
```

Update the fake SQL dispatcher to return the raw `model_pool` row for a `SELECT model_pool FROM operator_settings` query and to update its in-memory JSONB state for the bulk write.

- [ ] **Step 2: Run the focused test and confirm it fails.**

```bash
npm test -- packages/persistence/src/settings.test.ts
```

Expected: missing export/method failures.

- [ ] **Step 3: Add strict config validation and persistence methods.**

In `packages/contracts/src/settings.ts`, add:

```ts
export const SettingsModelPoolConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    enabledModelRefs: z.array(z.string().min(3)).superRefine((refs, ctx) => {
      if (new Set(refs).size !== refs.length) ctx.addIssue({ code: "custom", message: "enabledModelRefs must not contain duplicates" });
    }),
  })
  .strict();
export type SettingsModelPoolConfig = z.infer<typeof SettingsModelPoolConfigSchema>;
```

Use the existing model-map source list as the allow-list. Ensure the row before reading or writing. Sort refs before JSON persistence. `replaceModelPool` must issue one `UPDATE operator_settings ... model_pool = $2::jsonb` statement after validation. Keep `updateModelPool` behavior by reading raw refs, applying one change, and delegating to the same replacement logic. Export `readEnabledModelRefs` from `packages/persistence/src/index.ts` so Control Plane composition does not import an internal file path.

- [ ] **Step 4: Run persistence and contract tests.**

```bash
npm test -- packages/persistence/src/settings.test.ts packages/contracts/src/settings.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the persistence slice.**

```bash
git add packages/contracts/src/settings.ts packages/persistence/src/settings.ts packages/persistence/src/index.ts packages/persistence/src/settings.test.ts
git commit -m "feat: add atomic operator model pool persistence"
```

---

## Task 3: Thread authenticated operator identity into Worker admission

**Files:**

- Modify: `packages/persistence/src/worker/types.ts`
- Modify: `packages/persistence/src/worker/spawn.ts`
- Modify: `apps/control-plane/src/worker-service.ts`
- Test: `packages/persistence/src/worker.integration.test.ts`
- Test: `apps/control-plane/src/worker-service.test.ts`

**Interfaces:**

- Consumes: `OperatorContext.operatorId` in `createWorkerService.spawn()`.
- Produces:
  - `SpawnWorkerRequest.operatorId?: string` for the ensemble-only internal admission seam; pin-mode direct persistence callers remain source-compatible.
  - `WorkerAdmissionFactoryInput.operatorId: string`.
  - The value is passed unchanged to `createAdmission()`; `spawnWorker()` throws before provider admission if an ensemble request omits it.

- [ ] **Step 1: Write the failing identity propagation test.**

In the existing real PostgreSQL worker integration test that defines `createAdmission`, capture the input and assert:

```ts
expect(admissionInput.operatorId).toBe("operator-1");
```

Use a `headContext("product")` whose operator identity remains separate from the authenticated operator supplied to `spawnWorker`; this proves the code does not accidentally reuse `base.context.operatorId` or `actorId`.

Add a worker-service seam test that constructs an ensemble service with a stub admission and verifies the request passed to persistence contains the authenticated operator id.

- [ ] **Step 2: Run the focused tests and confirm the new assertion fails.**

```bash
npm test -- apps/control-plane/src/worker-service.test.ts packages/persistence/src/worker.integration.test.ts
```

Expected: the new captured field is undefined or the test fixture fails to compile.

- [ ] **Step 3: Thread the field without changing authorization semantics.**

Add optional `operatorId` to the internal spawn request and required `operatorId` to the admission factory input. In `createWorkerService.spawn()`, always pass `operator.operatorId` to `spawnWorker`. In `spawnWorker`, require `request.operatorId` immediately before calling `createAdmission`, then include it in that input. Pin-mode direct persistence callers do not need the field because they do not create an ensemble admission. Do not replace `CouncilActorContext.actorId`; it remains the captured Head actor used for authorization and admission context.

- [ ] **Step 4: Run focused worker tests.**

```bash
npm test -- apps/control-plane/src/worker-service.test.ts packages/persistence/src/worker.integration.test.ts
```

Expected: PASS when PostgreSQL integration prerequisites are present; otherwise the unit test must pass and the integration test must be reported as skipped by its existing database gate.

- [ ] **Step 5: Commit the identity slice.**

```bash
git add packages/persistence/src/worker/types.ts packages/persistence/src/worker/spawn.ts apps/control-plane/src/worker-service.ts apps/control-plane/src/worker-service.test.ts packages/persistence/src/worker.integration.test.ts
git commit -m "feat: carry operator identity into worker admission"
```

---

## Task 4: Apply the pool in the real Ensemble admission path

**Files:**

- Modify: `apps/control-plane/src/ensemble-admission.ts`
- Modify: `apps/control-plane/src/composition/execution-services.ts`
- Test: `apps/control-plane/src/ensemble-admission.test.ts`
- Test: `apps/control-plane/src/worker-service.test.ts`

**Interfaces:**

- Consumes: `WorkerAdmissionFactoryInput.operatorId`, `readEnabledModelRefs()`, and Task 1's selector field.
- Produces: an admission path that reads the operator pool immediately before selection and passes `operatorEnabledModelRefs` to `selectRoutedModel`.

- [ ] **Step 1: Write failing admission tests.**

Add an `ensemble-admission.test.ts` case with two valid candidates and `operatorEnabledModelRefs: ["openai/model-strong"]`; assert the selected model and routing evidence rejection for the excluded candidate. Add a case with an empty pool and assert the strongest eligible candidate remains selected.

Add an execution composition test with a fake PostgreSQL pool whose `SELECT model_pool` response changes between calls; invoke the composed admission twice and assert the second decision observes the changed pool. This prevents process-level caching.

- [ ] **Step 2: Run the focused tests and confirm they fail.**

```bash
npm test -- apps/control-plane/src/ensemble-admission.test.ts apps/control-plane/src/worker-service.test.ts
```

Expected: the admission input does not accept the pool and the composition does not query the operator pool.

- [ ] **Step 3: Implement runtime wiring.**

Add `operatorEnabledModelRefs` to `EnsembleNativeAdmissionInput`. Pass it from `createEnsembleNativeAdmission` into `selectRoutedModel`. In `composeExecutionServices`, the `ensembleAdmission` callback must call `readEnabledModelRefs(pool, input.operatorId)` on every request and pass the result along with the existing snapshot and catalog.

Keep the existing order: read the durable routing snapshot, read the catalog, read the current pool, select, create native admission, then persist evidence only after the native binding is recorded by the existing worker persistence path.

- [ ] **Step 4: Run focused runtime tests.**

```bash
npm test -- apps/control-plane/src/ensemble-admission.test.ts apps/control-plane/src/native-worker-acceptance.integration.test.ts
```

Expected: unit tests PASS; database-gated acceptance remains skipped unless `MAESTRO_TEST_DATABASE_URL` is configured.

- [ ] **Step 5: Commit the runtime slice.**

```bash
git add apps/control-plane/src/ensemble-admission.ts apps/control-plane/src/composition/execution-services.ts apps/control-plane/src/ensemble-admission.test.ts apps/control-plane/src/worker-service.test.ts
git commit -m "feat: wire operator pool into ensemble admission"
```

---

## Task 5: Build the Router Catalog contracts and backend service

**Files:**

- Create: `packages/contracts/src/router.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/router.test.ts`
- Create: `apps/control-plane/src/composition/model-map-source.ts`
- Modify: `apps/control-plane/src/composition/provider-access.ts`
- Create: `apps/control-plane/src/composition/router-catalog.ts`
- Test: `apps/control-plane/src/composition/router-catalog.test.ts`

**Interfaces:**

- Consumes: `ModelMap`, `readRoutingCandidateCatalog()`, `ModelGatewayPort.listModels()`, `readEnabledModelRefs()`, and `MaestroConfig.modelRoutingMode`.
- Produces:
  - `RouterCatalogReadSchema` and `RouterCatalogRead`.
  - `RouterConfigInputSchema` and `RouterConfigInput`.
  - `RouterConfigValidationSchema` and `RouterConfigValidation`.
  - `composeRouterCatalogService({ pool, config, modelGateway, settingsService })`.
  - `RouterCatalogService.get(operatorId)`, `.validate(operatorId, input)`, and `.replace(operatorId, input)`.

Use this exact validation response shape so preview and apply share one contract:

```ts
interface RouterConfigValidation {
  valid: boolean;
  enabledModelRefs: string[];
  unknownModelRefs: string[];
  changes: Array<{ modelRef: string; previousInUse: boolean; nextInUse: boolean }>;
}
```

- [ ] **Step 1: Write contract and service tests before implementation.**

Contract tests must reject:

```ts
RouterConfigInputSchema.safeParse({ schemaVersion: 1, enabledModelRefs: ["provider/model", "provider/model"] }).success === false;
RouterConfigInputSchema.safeParse({ schemaVersion: 1, enabledModelRefs: ["provider/model"], token: "secret" }).success === false;
```

Service tests must cover:

- `openai/model-a` and `openai-codex/model-a` are separate entries/groups.
- a live-only model has `baseline.present === false`, `state === "unprofiled"`, and cannot be enabled.
- a baseline model missing from a successfully read candidate catalog has `state === "not-a-candidate"`.
- unavailable candidate membership is `candidate.present === null` with `state === "candidate-unknown"`, never a confirmed noncandidate.
- unavailable Gateway membership is `live.present === null` with `state === "live-unknown"`; a successful listing that omits the model remains `live.present === false` / `live-unavailable`.
- missing candidate catalog returns `status: "inactive"` with an actionable reason and never exposes file contents or secrets; when both catalog sources fail, the reason identifies both.
- validation reports unknown model refs without mutating the pool.

Use the existing fake Gateway model shape and temporary JSON files for model map/candidate catalog; do not use real credentials.

- [ ] **Step 2: Run contract/service tests and confirm they fail.**

```bash
npm test -- packages/contracts/src/router.test.ts apps/control-plane/src/composition/router-catalog.test.ts
```

Expected: missing contract/service module failures.

- [ ] **Step 3: Add strict Router schemas.**

Define exact schemas for:

```ts
RouterRuntimeModeSchema = z.enum(["ensemble", "pin"]);
RouterRowStateSchema = z.enum([
  "routable",
  "pool-disabled",
  "live-unavailable",
  "live-unknown",
  "unprofiled",
  "not-a-candidate",
  "candidate-unknown",
  "catalog-ready",
]);
// `live.present` and `candidate.present` are `boolean | null`; null means the source could not be read.
RouterConfigInputSchema = z.object({ schemaVersion: z.literal(1), enabledModelRefs: z.array(z.string().min(3)) }).strict();
```

The catalog schema must strictly describe baseline, live, candidate, `inUse`, and row state. Do not include provider secrets, gateway tokens, binding IDs, or raw file paths.

- [ ] **Step 4: Extract and reuse validated model-map loading.**

Create `model-map-source.ts` with a loader that tries `MAESTRO_MODEL_MAP`, `process.cwd()/config/model_map.json`, `../../config/model_map.json`, and `../../../config/model_map.json`, validates with `assertValidModelMap`, and throws a descriptive Control Plane error when all paths fail. Refactor `composeSettingsService` to use this loader and retain its current score projection.

- [ ] **Step 5: Implement catalog composition.**

Load the full baseline, explicit candidates when `config.ensembleCandidateCatalogPath` exists, live Gateway models when a Gateway is configured, and raw operator refs. Build a union by exact `provider/model` identity. Represent candidate and live source membership independently: `present: null` when that source cannot be read, `false` only when a successful read omits the exact model, and `true` when it includes the exact model. Derive row states in this order:

1. absent from baseline → `unprofiled`
2. candidate membership unknown → `candidate-unknown`
3. absent from the successfully read candidate catalog → `not-a-candidate`
4. non-empty pool excludes it → `pool-disabled`
5. live catalog unavailable → `live-unknown`
6. successfully read live Gateway omits it → `live-unavailable`
7. present in baseline, candidate catalog, and live Gateway → `catalog-ready`

Return `status: "inactive"` when the candidate catalog is unavailable, `status: "partial"` when live data is unavailable but the baseline/catalog can be read, and `status: "ready"` when all static and live sources are available. Include both source failures in the reason when both are unavailable. A catalog row is static readiness only; Goal and TaskDemand checks remain admission-time.

- [ ] **Step 6: Run service tests and the provider-access regression suite.**

```bash
npm test -- packages/contracts/src/router.test.ts apps/control-plane/src/composition/router-catalog.test.ts apps/control-plane/src/composition/provider-access.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit contracts and service slice.**

```bash
git add packages/contracts/src/router.ts packages/contracts/src/index.ts packages/contracts/src/router.test.ts apps/control-plane/src/composition/model-map-source.ts apps/control-plane/src/composition/provider-access.ts apps/control-plane/src/composition/router-catalog.ts apps/control-plane/src/composition/router-catalog.test.ts
git commit -m "feat: add router catalog contracts and composition"
```

---

## Task 6: Add authenticated Router API and atomic import/export

**Files:**

- Create: `apps/control-plane/src/routes/router.ts`
- Modify: `apps/control-plane/src/routes/deps.ts`
- Modify: `apps/control-plane/src/server.ts`
- Modify: `apps/control-plane/src/main.ts`
- Test: `apps/control-plane/src/router-route.test.ts`
- Modify: `packages/contracts/src/settings.ts`
- Modify: `packages/persistence/src/settings.ts`

**Interfaces:**

- Consumes: `RouterCatalogService` from Task 5 and `SettingsService.replaceModelPool()` from Task 2.
- Produces these authenticated routes:
  - `GET /v1/router/catalog` → `RouterCatalogReadSchema`
  - `POST /v1/router/config/validate` → `RouterConfigValidationSchema`, no mutation
  - `PUT /v1/router/config` → `RouterCatalogReadSchema`, one atomic replacement

- [ ] **Step 1: Write failing route tests.**

Use the existing `buildServer()` test setup and authenticated bearer header. Add tests that assert:

```ts
expect(await app.inject({ method: "GET", url: "/v1/router/catalog", headers })).toHaveProperty("statusCode", 200);
expect(service.get).toHaveBeenCalledWith(operator.operatorId);

const preview = await app.inject({
  method: "POST",
  url: "/v1/router/config/validate",
  headers,
  payload: { schemaVersion: 1, enabledModelRefs: ["openai/model-a"] },
});
expect(preview.statusCode).toBe(200);
expect(service.validate).toHaveBeenCalledWith(operator.operatorId, { schemaVersion: 1, enabledModelRefs: ["openai/model-a"] });

const malformed = await app.inject({
  method: "POST",
  url: "/v1/router/config/validate",
  headers,
  payload: { schemaVersion: 1, enabledModelRefs: ["bad ref"] },
});
expect(malformed.statusCode).toBe(400);
expect(service.replace).not.toHaveBeenCalled();
```

Add a `PUT` test that asserts exactly one `replace` call with the authenticated operator id and the parsed body. Add a missing-service test that expects the existing durable-store unavailable response.

- [ ] **Step 2: Run the route tests and confirm they fail.**

```bash
npm test -- apps/control-plane/src/router-route.test.ts apps/control-plane/src/settings-route.test.ts
```

Expected: missing route/service and missing `SettingsService.replaceModelPool` failures.

- [ ] **Step 3: Extend route dependencies and server composition.**

Add `routerCatalogService?: RouterCatalogService` to `RouteDeps`, add `RouterRouteDeps = Pick<RouteDeps, "routerCatalogService">`, register the new route module after settings/catalog registration, and compose the service in `main.ts` with the existing database pool, config, Gateway, and settings service.

Use `requestOperator()` for every route. Parse all bodies with Zod before calling a service. Keep preview read-only and use the single `replace` service call for `PUT`.

- [ ] **Step 4: Run API tests and typecheck affected packages.**

```bash
npm test -- apps/control-plane/src/router-route.test.ts apps/control-plane/src/settings-route.test.ts packages/persistence/src/settings.test.ts
npx tsc -b packages/contracts/tsconfig.json packages/persistence/tsconfig.json apps/control-plane/tsconfig.json --pretty false
```

Expected: PASS.

- [ ] **Step 5: Commit the API slice.**

```bash
git add apps/control-plane/src/routes/router.ts apps/control-plane/src/routes/deps.ts apps/control-plane/src/server.ts apps/control-plane/src/main.ts apps/control-plane/src/router-route.test.ts packages/contracts/src/settings.ts packages/persistence/src/settings.ts

git commit -m "feat: expose authenticated router catalog API"
```

---

## Task 7: Add API client, Electron bridge, and Carnegie Router Catalog UI

**Files:**

- Create: `packages/api-client/src/methods/router.ts`
- Modify: `packages/api-client/src/client.ts`
- Modify: `packages/api-client/src/client.test.ts`
- Modify: `apps/carnegie/electron/apiBridge.ts`
- Modify: `apps/carnegie/electron/preload.cts`
- Modify: `apps/carnegie/src/views/Settings.tsx`
- Create: `apps/carnegie/src/views/Settings.test.tsx`
- Modify: `apps/carnegie/src/styles/components.css`

**Interfaces:**

- Consumes: Task 5 contracts and Task 6 routes.
- Produces renderer methods:
  - `getRouterCatalog(): Promise<RouterCatalogRead>`
  - `validateRouterConfig(input: RouterConfigInput): Promise<RouterConfigValidation>`
  - `replaceRouterConfig(input: RouterConfigInput): Promise<RouterCatalogRead>`

- [ ] **Step 1: Write API client tests.**

Extend the client transport fixture with assertions for:

```ts
await api.getRouterCatalog();
expect(request.url).toContain("/v1/router/catalog");

await api.validateRouterConfig({ schemaVersion: 1, enabledModelRefs: ["openai/model-a"] });
expect(request.method).toBe("POST");
expect(JSON.parse(request.body as string)).toEqual({ schemaVersion: 1, enabledModelRefs: ["openai/model-a"] });

await api.replaceRouterConfig({ schemaVersion: 1, enabledModelRefs: ["openai/model-a"] });
expect(request.method).toBe("PUT");
```

- [ ] **Step 2: Run the client tests and confirm they fail.**

```bash
npm test -- packages/api-client/src/client.test.ts
```

Expected: missing methods/types.

- [ ] **Step 3: Implement typed client methods and bridge exposure.**

Create the router method factory, add its methods to `ApiClient`, import/export contract types, and include the three names in both `exposedApiMethods` arrays. Keep the preload list manually synchronized as documented in that file.

- [ ] **Step 4: Write focused Settings UI tests.**

Create a render fixture with `window.maestro.api` returning:

- one `openai` catalog-ready row
- one `openai-codex` live-only row
- one `anthropic` pool-disabled row
- `status: "partial"` and then `status: "inactive"`

Assert:

```ts
expect(screen.getByText("Ensemble Router")).toBeInTheDocument();
expect(screen.getByText("openai-codex")).toBeInTheDocument();
expect(screen.getByRole("button", { name: /add|enable/i })).toBeDisabled();
expect(screen.getByText(/candidate catalog/i)).toBeInTheDocument();
```

Mock a toggle and assert `replaceRouterConfig` is called once with the complete pool and the returned catalog is adopted without a follow-up GET. Mock file upload and assert validation is called before apply; assert cancel/failed validation does not call replacement. Assert download creates a JSON document containing only `schemaVersion` and `enabledModelRefs`.

- [ ] **Step 5: Run UI tests and confirm they fail.**

```bash
npm test -- apps/carnegie/src/views/Settings.test.tsx
```

Expected: missing Router Catalog method/render behavior.

- [ ] **Step 6: Replace the old model tabs with the real catalog.**

In `Settings.tsx`:

- load `getRouterCatalog()` when the `models` panel opens and on refresh
- show runtime mode and `ready/partial/inactive` status
- group entries by exact `providerId`
- filter by search, Provider, row state, and in-use status
- render baseline, live, candidate/account, and pool state columns
- disable enabling for `unprofiled`, `candidate-unknown`, and confirmed `not-a-candidate` rows; render live and candidate unknown states separately from confirmed absence
- use the existing `ToggleSwitch` or a labeled button for pool changes
- keep `openai` and `openai-codex` as separate groups
- implement strict JSON download with a Blob URL and cleanup
- implement file upload as parse → preview validation → explicit apply
- never render account secrets or raw paths

Use the existing settings status/error pattern and preserve provider login behavior.

- [ ] **Step 7: Add styles and run renderer checks.**

Add scoped classes in `components.css` for grouped headers, status badges, table rows, disabled reasons, filter controls, and import preview. Respect the existing light/dark theme tokens and keyboard focus styles.

Run:

```bash
npm test -- packages/api-client/src/client.test.ts apps/carnegie/src/views/Settings.test.tsx
npx tsc -p apps/carnegie/tsconfig.json --pretty false
npx tsc -p apps/carnegie/tsconfig.renderer.json --noEmit --pretty false
```

Expected: PASS.

- [ ] **Step 8: Commit the bridge/UI slice.**

```bash
git add packages/api-client/src/methods/router.ts packages/api-client/src/client.ts packages/api-client/src/client.test.ts apps/carnegie/electron/apiBridge.ts apps/carnegie/electron/preload.cts apps/carnegie/src/views/Settings.tsx apps/carnegie/src/views/Settings.test.tsx apps/carnegie/src/styles/components.css
git commit -m "feat: connect Carnegie router catalog to control plane"
```

---

## Task 8: Prove the full UI-to-Gateway routing path

**Files:**

- Modify: `apps/control-plane/src/native-worker-acceptance.integration.test.ts`
- Create: `apps/control-plane/src/router-runtime.integration.test.ts`
- Create: `config/ensemble-candidates.example.json`

**Interfaces:**

- Consumes: Tasks 1–7, real PostgreSQL migrations, `createControlPlane()`, the existing in-process Model Gateway server, and the existing worker/council/mission-bundle setup helpers.
- Produces: a release gate proving that a persisted UI-equivalent pool change changes the actual Gateway admission identity.

- [ ] **Step 1: Add the temporary exact candidate catalog fixture.**

Create `config/ensemble-candidates.example.json` with this shape and no credentials:

```json
{
  "schemaVersion": 1,
  "entries": [
    {
      "candidateRef": "test-model-a",
      "modelRef": "test/model-a",
      "accountBinding": "acceptance-account-1"
    }
  ]
}
```

Document that the example is not loaded automatically. The integration test writes its own two-candidate catalog to a temporary path because both candidates need matching human profiles and Goal observations.

- [ ] **Step 2: Write the failing full-path test.**

In `router-runtime.integration.test.ts`, use the existing database gate and fake provider/Gateway pattern to:

1. create two exact test model-map profiles and a two-entry candidate catalog in a temporary directory
2. create a Goal, Council, plan, Mission Bundle, routing work input, and Goal overlay with both candidates available
3. configure `modelRoutingMode: "ensemble"`, the temporary catalog path, and the Gateway HTTP URL
4. call the real authenticated `PUT /v1/router/config` with only `test/model-a`
5. spawn the real Worker through the Control Plane
6. assert the provider/Gateway received `test/model-a` and its account binding
7. replace the pool with only `test/model-b`, spawn a new attempt, and assert `test/model-b`
8. replace the pool with an unknown human-map ref and assert HTTP 400 with no worker/provider admission
9. query `ensemble_router_routing_evidence` and assert the excluded candidate has reason `operator model pool excludes candidate`

- [ ] **Step 3: Run the acceptance test and confirm the new assertions fail.**

```bash
MAESTRO_TEST_DATABASE_URL="$MAESTRO_TEST_DATABASE_URL" npm test -- apps/control-plane/src/router-runtime.integration.test.ts
```

Expected before wiring: the test either cannot compose the router service or selects the wrong/unrestricted candidate.

- [ ] **Step 4: Implement only test harness setup needed for the real path.**

Reuse the existing migration, operator, project membership, Gateway, and provider helpers. Keep provider behavior deterministic and record received `provider/model` and `accountRef` in memory for assertions. Do not add a production bypass, test-only runtime fallback, or invented live model profile.

- [ ] **Step 5: Run the full acceptance and focused regression suite.**

```bash
npm test -- apps/control-plane/src/router-runtime.integration.test.ts apps/control-plane/src/native-worker-acceptance.integration.test.ts apps/control-plane/src/ensemble-admission.test.ts packages/domain/src/routing-selector.test.ts
```

Expected: PASS with `MAESTRO_TEST_DATABASE_URL`; database-gated tests are skipped only when that variable is absent.

- [ ] **Step 6: Run repository verification for the completed feature.**

```bash
npx tsc -b packages/contracts/tsconfig.json packages/domain/tsconfig.json packages/persistence/tsconfig.json packages/api-client/tsconfig.json apps/control-plane/tsconfig.json --pretty false
npx tsc -p apps/carnegie/tsconfig.renderer.json --noEmit --pretty false
npm run lint -- --no-warn-ignored
npm run migrations:check
git diff --check
```

Review that no provider token, raw account credential, temporary absolute path, or unrelated UI change appears in the feature diff.

- [ ] **Step 7: Commit the acceptance slice.**

```bash
git add apps/control-plane/src/native-worker-acceptance.integration.test.ts apps/control-plane/src/router-runtime.integration.test.ts config/ensemble-candidates.example.json
git commit -m "test: prove router pool reaches model gateway admission"
```

---

## Lockstep release note — Router Catalog v1

Deploy the Control Plane and Carnegie consumer together. This contract revision returns nullable `candidate.present` / `live.present`, adds `candidate-unknown` / `live-unknown` row states, and adds `nonCandidateModelRefs` to router-config validation responses. Older strict-v1 clients may reject null membership, the new row states, or the added validation field. The updated Carnegie consumer accepts old boolean membership values and defaults a missing `nonCandidateModelRefs` field to `[]`.

The operator router-config JSON remains schema version 1, and this change requires no database schema migration. Do not roll out the revised Control Plane response ahead of its updated Carnegie consumer.

---

## Completion Gate

Do not report the feature complete until all of these are true:

- `GET /v1/router/catalog` reports the actual runtime mode and candidate catalog state.
- `PUT /v1/router/config` atomically changes the operator pool.
- A live-only model cannot be enabled from the UI.
- A non-empty pool changes the next Ensemble selection.
- The selected exact model and account binding reach `ModelGatewayPort.admit()`.
- Routing evidence includes pool exclusions.
- An empty effective candidate set fails closed without pin fallback.
- The real PostgreSQL + Model Gateway acceptance test passes.
- Focused tests, affected typechecks, lint, migration checks, and `git diff --check` pass.
