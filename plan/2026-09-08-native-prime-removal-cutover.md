# Maestro Native Backend and Prime Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Prime Agent from every production and test dependency path, run Worker/Head/reviewer execution through the native Maestro runtime and Model Gateway, and then resume the Phase 1 hardening queue with real PostgreSQL and real-process evidence.

**Architecture:** The Control Plane owns only a provider-neutral `ExecutionKernelPort` and host-side Tool registry. A native kernel router admits an exact provider-qualified model through the authenticated Model Gateway, creates `MaestroAgentRuntime` sessions with immutable host grants, and routes execution references to the correct runtime. The gateway remains the only owner of provider SDKs and credentials. PostgreSQL remains authoritative for Goal/lease/worker/reviewer state; in-memory runtime state is disposable and ambiguous provider outcomes become durable `unknown` state.

**Tech Stack:** TypeScript, Node.js 24, Fastify 5, Zod 4, PostgreSQL/`pg`, native `fetch`/`AbortController`, Vitest, existing `@maestro/agent-runtime`, `@maestro/model-provider-openai`, `@maestro/model-provider-anthropic`, `@maestro/api-client`, and `@maestro/contracts`.

**Spec:** `plan/2026-09-07-maestro-native-agent-backend.md`, `plan/specs/2026-09-07-maestro-native-agent-backend-design.md`, `plan/phase1.md` through `plan/phase8.md`.

## Global Constraints

- No production import, package dependency, lockfile entry, config field, test fixture, README claim, or security/setup instruction may require `prime-agent`, `@maestro/prime-adapter`, `createPrimeExecutionKernel`, or `primeAgentVersion` after the removal task.
- Prime is removed, not retained as a fallback. Test-only `ExecutionKernelPort` injection remains supported.
- Every native admission carries an immutable host-created `InvocationContext`, `CapabilityGrant`, exact provider-qualified model policy, Goal lease/fencing identity where a Goal effect is involved, and an idempotency key.
- Model output cannot select a route, actor, Goal, account, credential, generic endpoint, filesystem path, or approval authority.
- The Model Gateway owns provider SDKs, API keys, managed subscription login, and provider binding handles. Secrets never enter PostgreSQL, model messages, TUI state, evidence payloads, or logs.
- Missing native tools, incompatible data policy, unknown provider/model, stale fencing, and ambiguous provider outcomes fail closed. A capability may not be silently dropped.
- Provider/model switches affect only new admissions. Existing execution bindings remain immutable.
- Existing typed Control Plane, CLI, Secretary, and TUI authority boundaries remain authoritative. No UI may invent durable state or credentials.
- Do not touch `.worktrees/device-grant-expiry` or `.worktrees/local-gateway-bootstrap`; neither is part of this plan's working tree.
- Each implementation slice must have a focused red test, a green focused test, `npm run build`, an independent review, a Conventional Commit, a push to `origin/main`, and an evidence entry in `plan/operations/findings.md` and `plan/operations/progress.md`.
- Phase acceptance requires disposable PostgreSQL and real-process gates. Unit tests alone never close a phase.

## Current Repository Findings

- `apps/control-plane/src/main.ts:8,78` still imports and constructs `createPrimeExecutionKernel()`.
- `apps/control-plane/package.json`, `apps/control-plane/tsconfig.json`, root `tsconfig.json`, `package-lock.json`, and `packages/prime-adapter` still carry Prime.
- `packages/agent-runtime/src/agent-runtime.ts` already implements the common model/tool/child loop, but its runtime state is process-local and its `ToolRegistry` is empty by default. Its `definitions()` currently omits unknown tools instead of rejecting them.
- `apps/control-plane/src/conversation-service.ts` is already native and persists conversations/turns/events, but this native composition is not reused for Worker, Head, semantic-review, Encore, or team-lead helper admissions.
- `apps/model-gateway` already exposes authenticated model listing, admission, streaming turns, cancellation, recovery, API-key binding, and Codex account-login routes. `apps/control-plane/src/model-gateway-client.ts` already validates the wire response shape.
- Worker persistence already durably owns provider execution/invocation refs and restart fencing, but it does not persist the selected/actual provider model identity. Head/reviewer/helper call sites still issue bare `kernel.spawn()` requests.
- Mission Bundles allow arbitrary non-qualified strings such as `model-a`, while native admission requires `provider/model-id`. Existing persistence fixtures use `model-a` and `read`/`write` tool names that are not registered native host tools.
- A full PostgreSQL check is currently running from commit `d0f14d3`; its result must be preserved before changing implementation code. The isolated first failure is already closed: Worker restart PostgreSQL test is 33/33 and build passes.

## Dependency Graph and Execution Order

```text
A. Contract/audit baseline (this plan)
   └── B. Native kernel router + composition seam
       ├── C. Explicit model/grant propagation for Worker/Head/review/helper paths
       │   └── D. Durable native execution binding/model evidence
       ├── E. Host Tool registry and strict capability rejection
       └── F. Config/API/fixture migration and real HTTP acceptance
           └── G. Delete Prime package, tests, lockfile, and all references
               └── H. Full PostgreSQL + Phase 1 patch queue, one failure at a time
```

Tasks B, E, and the discovery part of F can be reviewed independently. C and D must be serial because C defines the identity that D persists. G is blocked until B–F focused tests and the real gateway/control-plane smoke pass.

---

## Task A — Freeze the baseline and audit evidence

**Status:** plan/audit in progress; no implementation code changes in this task.

**Files:**
- Read: `docs/OPERATING_PROTOCOL.md`, `plan/operations/task_plan.md`, `plan/operations/findings.md`, `plan/operations/progress.md`, `plan/phase1.md`–`plan/phase8.md`, native backend and TUI plans.
- Maintain: `plan/act1-execution.md`, `plan/operations/findings.md`, `plan/operations/progress.md`.

**Required evidence:**

- [ ] Preserve the exit code and final summary of the active `MAESTRO_TEST_DATABASE_URL=postgresql://maestro@127.0.0.1:55471/maestro_test npm run check` run in a durable log before deleting temporary logs.
- [ ] Record current `git status`, `git worktree list`, `git rev-parse HEAD`, `npm run build`, and no-database check counts.
- [ ] Record the Prime reference inventory and the native call-site inventory listed above.
- [ ] Do not claim any Phase 1 gate green from the no-database result.

**Exit criteria:** This plan and the evidence ledger are committed and pushed before implementation starts. The active PostgreSQL run is either complete with preserved output or explicitly marked interrupted with a reason.

Commit: `docs(plan): define native prime removal cutover`.

---

## Task B — Add a native Control Plane execution-kernel router

**Files:**
- Create: `apps/control-plane/src/native-execution-kernel.ts`.
- Create: `apps/control-plane/src/native-execution-kernel.test.ts`.
- Modify: `apps/control-plane/src/main.ts`.
- Modify: `apps/control-plane/package.json`, `apps/control-plane/tsconfig.json`.
- Modify: `apps/control-plane/src/config.ts`, `apps/control-plane/src/config.test.ts`.

**Interface produced:**

```ts
export interface NativeExecutionKernelOptions {
  readonly gateway: ModelGatewayPort;
  readonly gatewayOperatorId: string;
  readonly accountRefs: Readonly<Record<string, string>>;
  readonly dataPolicyHash: string;
  readonly tools: ToolRegistry;
}

export function createNativeExecutionKernel(
  options: NativeExecutionKernelOptions,
): ExecutionKernelPort & { close(): Promise<void> };
```

The router must:

1. Reject a root `SpawnRequest` without exactly one provider-qualified `modelPolicy` entry, host `context`, host `grant`, and `idempotencyKey`.
2. Parse the model with `parseModelRef`, resolve the account ref from the configured provider map, and call `gateway.admit()` before returning the spawn result.
3. Construct `createMaestroAgentRuntime({ gateway, binding, tools })` with the returned immutable `GatewayBinding`.
4. Route `prompt`, `observe`, `sendMessage`, `getModelIdentity`, `getToolEvents`, `getUsage`, `getInvocationStatus`, `cancel`, `release`, `resume`, and `reconnect` by opaque execution/invocation ref without exposing the runtime map.
5. Route child requests to the parent runtime and reject cross-runtime parents, widened grants, changed model policy, or changed account binding.
6. Close all runtimes and the gateway exactly once. A provider admission error must not leave a durable worker/head reservation looking active; the caller's existing unknown/recovery path handles ambiguous transport outcomes.

**Tests first:**

```ts
it("admits the exact provider/model before native spawn and routes observations", async () => {
  const kernel = createNativeExecutionKernel(fakeNativeOptions());
  const spawned = await kernel.spawn(nativeRootRequest("test/model-a"));
  expect(gateway.admit).toHaveBeenCalledWith(expect.objectContaining({ providerId: "test", model: { provider: "test", id: "model-a" } }));
  expect(await kernel.getModelIdentity(spawned.execution)).toEqual({ provider: "test", id: "model-a" });
});

it("rejects a bare or model-mismatched admission before provider work", async () => {
  await expect(kernel.spawn({ name: "bare" })).rejects.toThrow("host-owned context");
  expect(gateway.admit).not.toHaveBeenCalled();
});

it("keeps child execution inside the parent runtime and rejects a widened grant", async () => {
  await expect(kernel.spawn({ ...nativeChildRequest, grant: widenedGrant })).rejects.toThrow("child grant widens parent capability");
});
```

**Verification:**

```bash
npm test -- apps/control-plane/src/native-execution-kernel.test.ts
npm run build
```

Commit: `feat(control-plane): compose native execution kernel`.

---

## Task C — Carry explicit model policy and host grants through every execution path

**Files:**
- Modify: `packages/contracts/src/index.ts` and its contract tests.
- Modify: `packages/domain/src/mission-bundle.ts`, `packages/domain/src/mission-bundle.test.ts`.
- Modify: `packages/persistence/src/worker.ts`, `packages/persistence/src/worker.integration.test.ts`.
- Modify: `apps/control-plane/src/worker-service.ts` and worker API tests.
- Modify: `apps/control-plane/src/head-participation-service.ts` and head API tests.
- Modify: `packages/persistence/src/semantic-review.ts`, `semantic-review.test.ts`.
- Modify: `packages/persistence/src/encore-council.ts`, `encore-council.test.ts`.
- Modify: `packages/persistence/src/team-lead-grant.ts`, `team-lead-grant` tests.
- Modify: `apps/control-plane/src/main.ts` service composition.

**Contract changes:**

- Add optional `model` to `SpawnWorkerInputSchema`; if omitted, a Mission Bundle with exactly one approved model selects that model. If more than one is approved, omission is rejected as ambiguous.
- Require Mission Bundle approved models to match `^[^/\\s]+/[^/\\s]+$` and expose `parseModelRef()` validation at the domain boundary. Existing test fixtures become `test/model-a`.
- Add a shared host-created `ExecutionAdmission` type containing `InvocationContext`, `CapabilityGrant`, `modelPolicy`, and `idempotencyKey`. It is not accepted from model output.
- Add the admission to Head, semantic-review, Encore, and helper-worker service dependencies/requests. Tests use explicit fake admissions; production composition derives them from the Goal, captured actor, Mission Bundle, lease proof, and configured default model.

**Worker admission rules:**

1. Resolve `modelRef = input.model ?? (approvedModels.length === 1 ? approvedModels[0] : reject)`.
2. Verify the selected model is in the immutable Mission Bundle allowlist before any provider call.
3. Build `InvocationContext` from the captured Council/Goal/project/Head session and current fencing proof.
4. Build `CapabilityGrant` from the exact bundle tools, skills, paths, data classes, retry/time ceilings, and selected model.
5. Pass `context`, `grant`, `modelPolicy: [modelRef]`, and a command-derived idempotency key into `kernel.spawn()`.
6. For a team-lead child, derive an intersection grant from the durable parent worker/grant; never pass a bare `{ parent }` request.

**Head/reviewer rules:**

- Head activation uses the configured default provider-qualified model and a Goal-scoped read/coordination grant. It cannot spawn without a model/account binding.
- Semantic review and Encore reviewers get read-only evidence grants, explicit model policy, fixed Goal/project context, bounded output, and unique idempotency keys. Reviewer output remains untrusted text.
- Every execution path remains compatible with injected fake kernels, but production native composition has no implicit legacy default.

**Tests first:** Add failures for missing model, non-qualified model, ambiguous approved models, widened child grant, bare Head/reviewer spawn, stale lease, and changed model policy. Confirm no provider admission/spawn occurs on each rejection.

**Verification:**

```bash
npm test -- packages/domain/src/mission-bundle.test.ts packages/persistence/src/worker.integration.test.ts packages/persistence/src/semantic-review.test.ts packages/persistence/src/encore-council.test.ts
npm run build
```

Commit: `feat(runtime): propagate native model and capability grants`.

---

## Task D — Persist native execution binding and model evidence

**Files:**
- Create: `packages/persistence/migrations/0070_native_execution_bindings.sql`.
- Modify: `packages/persistence/src/worker.ts` and worker integration tests.
- Modify: `packages/persistence/src/head-participation.ts`, `semantic-review.ts`, `encore-council.ts`, and their read models where identity is exposed.
- Modify: `packages/domain/src/worker.ts` and `packages/contracts/src/index.ts` only for non-secret model identity fields.
- Create: `packages/persistence/src/native-execution-binding.ts` and focused tests if the existing worker row cannot safely own the shared binding.

**Durable schema contract:** Use an append-only `native_execution_bindings` record keyed by immutable execution/invocation refs. Store only provider/model identity, account reference, gateway instance/binding metadata, Goal/project identity, admission kind, fencing token, and timestamps. Do not store API keys, OAuth tokens, provider prompt content, or raw tool results. Add database checks/triggers preventing identity mutation and cross-Goal/project binding.

**Lifecycle:**

- Insert the binding after successful gateway admission and before provider prompt/effect.
- Link the binding to the worker/head/reviewer durable row before the external call is considered active.
- Persist actual provider/model identity from `getModelIdentity()` and reject a mismatch with the selected policy.
- On restart, use the durable binding plus existing lease/recovery code. A gateway binding from a dead gateway instance is not resumed automatically; the execution becomes `unknown` unless the provider explicitly proves a safe terminal state.
- Record one idempotent recovery decision for ambiguous bindings and retain opaque refs for audit.

**Tests first:** PostgreSQL tests must cover insert-before-effect, immutable identity, project/Goal mismatch, stale fencing, duplicate command replay, provider identity mismatch, restart-to-unknown, and no-secret persistence. Run migrations in an empty schema, twice, and against a schema already created by `applyAllMigrations`.

**Verification:**

```bash
npm test -- packages/persistence/src/native-execution-binding.integration.test.ts packages/persistence/src/worker.integration.test.ts
npm run build
```

Commit: `feat(persistence): record native execution bindings`.

---

## Task E — Register real host tools and reject unsupported capabilities

**Files:**
- Create: `apps/control-plane/src/native-tools.ts`.
- Create: `apps/control-plane/src/native-tools.test.ts`.
- Modify: `packages/agent-runtime/src/agent-runtime.ts` and `agent-runtime.test.ts`.
- Modify: `apps/control-plane/src/main.ts`.
- Modify: Mission Bundle fixtures and tool-policy tests.

**Host tool set:** Register only fixed, typed, project/Goal-bound operations with Zod schemas:

- `read_goal`: read the bound Goal and control state.
- `read_events`: read bounded durable Goal events after a cursor.
- `read_worker`: read the bound worker's durable observation/evidence.
- `request_critical_approval`: create an approval request only; never execute the effect and never self-approve.

Each definition has a fixed handler, input/output schema, read/effect classification, outbound data class, byte/depth limit, and required capability. The handler receives immutable `ToolContext`; model arguments cannot replace project/Goal/operator/fencing fields. Tool results are marked untrusted and are redacted/bounded before they return to the provider.

Change `ToolRegistry.definitions()` so an allowed tool that is not registered throws `unsupported capability` instead of silently disappearing. Change execution to validate the model call ID, canonical argument hash, grant, lease, idempotency, and durable approval before any effect. A duplicate identical call replays the durable result; a duplicate call ID with changed arguments is rejected.

**Tests first:** Add canary-secret, prompt-injection, unregistered tool, wrong Goal/project, stale fence, missing approval, oversized output, duplicate-identical, and duplicate-different argument tests. Assert the effect adapter is not called on all rejection paths.

**Verification:**

```bash
npm test -- packages/agent-runtime/src/agent-runtime.test.ts apps/control-plane/src/native-tools.test.ts
npm run build
```

Commit: `feat(runtime): add bounded native control-plane tools`.

---

## Task F — Migrate configuration, fixtures, and real HTTP acceptance

**Files:**
- Modify: `apps/control-plane/src/config.ts`, `config.test.ts`, `main.ts`.
- Modify: all config fixtures in `apps/control-plane/src/*.test.ts`, `apps/device-agent/src/main.integration.test.ts`, and `apps/secretary/src/cli-secretary-parity.integration.test.ts`.
- Modify: `apps/model-gateway/src/main.ts`, gateway tests, and `apps/control-plane/src/model-gateway-client.test.ts` only where contract gaps are found.
- Modify: `README.md`, `.env.example` if present, `SECURITY.md`, and operator docs.

**Configuration contract:**

- Delete `primeAgentVersion` from `MaestroConfig` and every fixture.
- Add `MAESTRO_NATIVE_MODEL` as a provider-qualified default for bare internal paths that cannot derive a Mission Bundle model. Reject an unqualified value during config parsing.
- Require `MAESTRO_MODEL_GATEWAY_TOKEN` for production native execution. Test-only injected kernels may omit it.
- Keep `MAESTRO_MODEL_ACCOUNT_REFS` opaque and redacted; never put credential values in config logs.

**HTTP acceptance script:** Create a checked-in or documented shell-free Node probe that:

1. Starts the built Model Gateway with fake provider credentials or the configured local credential store.
2. Verifies `GET /healthz` and authenticated `GET /v1/models`; validates provider-qualified identities and no raw secrets.
3. Starts a built Control Plane against disposable PostgreSQL and verifies `GET /healthz`.
4. Exercises authenticated model listing through the Control Plane API and verifies the same catalog as the gateway.
5. Exercises the Codex login start/status/cancel routes when `MAESTRO_CODEX_APP_SERVER_COMMAND` is configured; without it, verifies the route fails closed with an explicit unavailable error rather than claiming success.
6. Creates a conversation and one native Worker/Head admission, verifies the provider/model identity, durable binding, event stream, cancellation, and restart-to-unknown behavior.

**Verification:**

```bash
npm run build
npm test -- apps/control-plane/src/config.test.ts apps/control-plane/src/main.integration.test.ts apps/model-gateway/src/rpc.test.ts apps/control-plane/src/model-gateway-client.test.ts
MAESTRO_TEST_DATABASE_URL=postgresql://maestro@127.0.0.1:55471/maestro_test npm test -- apps/control-plane/src/main.integration.test.ts apps/control-plane/src/head-participation-api.integration.test.ts
```

Commit: `test(acceptance): verify native gateway and control plane paths`.

---

## Task G — Remove Prime completely

**Files:**
- Delete: `packages/prime-adapter/` source, tests, package metadata, and generated `dist/` output after a clean build.
- Modify: `package.json`, `package-lock.json`, `tsconfig.json`.
- Modify: `apps/control-plane/package.json`, `apps/control-plane/tsconfig.json`.
- Delete/replace: `packages/prime-adapter/src/sdk.live.test.ts`; replace its contract coverage with native gateway/runtime contract tests and the real HTTP acceptance script.
- Modify: all source/test/config/docs files found by the Prime inventory in Task A.

**Removal procedure:**

1. Run a red dependency/source scan after removing the Control Plane import but before deletion. The scan must show only the expected package/test references.
2. Delete the package and remove project references/dependencies.
3. Run `npm install` to regenerate the lockfile; inspect the diff and ensure no Prime tarball or transitive Prime package remains.
4. Update all fixtures from `model-a` to `test/model-a` and from generic `read`/`write` names to registered fixed host tools or explicit unsupported-capability test cases.
5. Replace comments that describe Prime as the provider with native runtime/gateway wording. Keep historical plan findings only when explicitly marked historical; no production/reference documentation may instruct operators to install or configure Prime.
6. Run the no-Prime scan:

```bash
grep -RInE 'prime-agent|@maestro/prime-adapter|createPrimeExecutionKernel|primeAgentVersion|built on Prime Agent' \
  apps packages README.md SECURITY.md .env.example package.json package-lock.json tsconfig.json \
  --exclude-dir=dist --exclude-dir=node_modules
```

Expected: zero output. Plan history may mention the migration, but production source/manifests/lockfile/docs must not.

**Verification:**

```bash
npm install
npm run build
npm test -- packages/agent-runtime apps/model-gateway packages/model-provider-openai packages/model-provider-anthropic apps/control-plane
npm run check
```

Commit: `refactor(control-plane): remove prime agent runtime`.

---

## Task H — Resume Phase 1 patches and close the operational gate

This task begins only after Task G's no-Prime scan, native focused tests, build, and real HTTP smoke pass.

**Failure order:** Reproduce one failure in isolation, write/fix the regression test first, implement the smallest durable change, run focused PostgreSQL verification, run build, obtain independent review, update docs, commit, push, then select the next failure.

1. Concertmaster report failures in `packages/persistence/src/concertmaster-report.integration.test.ts`.
2. Git integration status failure in `packages/persistence/src/git-integration.integration.test.ts`.
3. Metronome device-command finding failure in `packages/persistence/src/metronome.integration.test.ts`.
4. Certification conflict/waiver failures in `packages/persistence/src/certification-conflict.integration.test.ts`.
5. Any remaining device-agent runtime failure in `packages/persistence/src/device-agent-runtime.integration.test.ts`; review the independently created `239db3e fix(device-agent): persist lapsed grant closure` worktree commit before deciding whether to cherry-pick or reimplement it on `main`.
6. Re-run all Phase 1 real-process gates: killed active Goal process, reconciliation leader fencing, stale lease writes, approval/effect boundary, app/CLI parity, and gateway/control-plane health/model/login paths.

**Required final evidence:**

```bash
npm run build
npm test
MAESTRO_TEST_DATABASE_URL=postgresql://maestro@127.0.0.1:55471/maestro_test npm run check
npm test -- packages/agent-runtime/src/model-provider.test.ts packages/agent-runtime/src/provider-registry.test.ts
```

Record exact file/test counts, PostgreSQL container identity, real-process timings, HTTP status/results, no-Prime scan output, and any provider environment limitation. Update `plan/act1-execution.md` to mark only evidence-backed items complete and leave later Phase 2–8 work blocked until Phase 1's exit gate is genuinely green.

Commit each patch separately using `fix(<scope>): ...`; push every commit immediately. Finish with a concise changelog and a clean `git status` on `main`.

---

## Rollback and Safety

- Never delete or rewrite the separate worktrees. If a native cutover slice fails, revert only its own commit or disable the new composition through an explicit test override; never restore Prime as a production fallback.
- A missing gateway credential/model or missing host Tool is an explicit startup/admission error, not an automatic provider fallback.
- A provider timeout after external admission is `unknown` and remains fenced until reconciliation proves a safe terminal state.
- Database migrations are additive and checksum-protected. Every migration is tested on an empty schema, an already-migrated schema, and concurrent migration runners.
- Push only commits that have the slice's focused test, build, and documentation evidence.

## Plan Self-Review

- **Spec coverage:** Provider-neutral runtime, provider registry/gateway, auth boundary, model policy, host Tool safety, child grants, cancellation, durable conversation, Worker/Head/reviewer propagation, real HTTP acceptance, Prime deletion, and Phase 1 PostgreSQL/real-process gates are each assigned to Tasks B–H.
- **No silent fallback:** Task B rejects missing native admission; Task E rejects missing tools; Task G requires a zero-reference scan.
- **Type consistency:** `NativeExecutionKernelOptions` consumes the existing `ModelGatewayPort`/`ToolRegistry`; Task C supplies the `SpawnRequest` fields required by the router; Task D persists the `GatewayBinding` identity produced by Task B; Task F composes the same router in `main.ts`.
- **Known boundary:** Existing conversation tables do not replace worker/head/reviewer execution evidence. Task D explicitly adds that durable binding before the Prime removal gate.
