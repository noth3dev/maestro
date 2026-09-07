# Maestro Native Agent Backend Implementation Plan

> **Implementation workflow:** Execute this plan task by task and keep the checkboxes updated. Use the repository's current agent workflow; this document is the source of truth for scope and order.

**Goal:** Remove Prime Agent from Maestro and replace it with a native provider-pluggable agent backend that supports natural-language control, common Tool/child-agent execution, OpenAI/Anthropic API-key authentication, and OpenAI subscription access only through the documented Codex app-server boundary. Claude Pro/Max subscription OAuth is blocked without written Anthropic approval.

**Architecture:** `MaestroAgentRuntime` owns the agent loop, sessions, child invocations, Tool dispatch, cancellation, observations, and Control Plane boundaries. It uses an authenticated narrow `ModelGatewayPort` RPC. A separate `apps/model-gateway` process owns `ModelProviderPort`, the allowlisted `ProviderRegistry`, provider SDKs, API keys, OAuth refresh, and Codex app-server pairing. `ExecutionKernelPort` remains the Control Plane boundary, and Prime Agent is removed rather than retained as a fallback.

**Tech Stack:** TypeScript, Node.js, Fastify 5, Zod 4, PostgreSQL/`pg`, native `fetch`/`AbortController`, OpenAI Responses API, Anthropic Messages API, Vitest, existing `@maestro/api-client` and `@maestro/contracts` packages.

**Spec:** `plan/specs/2026-09-07-maestro-native-agent-backend-design.md`

## Global Constraints

- No production import, package dependency, lockfile entry, or config field may require `prime-agent` or `@maestro/prime-adapter` after the removal task.
- Natural-language control remains available through the native runtime; it is not proposal-only and does not disable when a model provider changes.
- Model providers receive only normalized messages/tool schemas; they never receive PostgreSQL, persistence, shell, filesystem, MCP, or child-agent authority.
- Every model tool call is validated host-side against a strict schema, project/Goal binding, Mission Bundle capability, lease/fencing state, idempotency, and durable approval requirements before execution.
- API-key and subscription OAuth authentication are separate provider/auth identities and never share endpoint/header assumptions.
- OAuth tokens and API keys remain in the provider gateway's process-local/OS-backed credential store and never enter PostgreSQL, event payloads, TUI session files, model prompts, or logs.
- `Mission Bundle.approvedModels` must match the canonical `provider/model-id` identity before provider admission; no legacy permissive fallback is allowed in production.
- Provider/runtime switches apply only to new sessions; in-flight invocation bindings are immutable.
- Unknown provider state is reported as `unknown` and blocks automatic retry when the provider outcome is not provable.
- Existing CLI/`--json` behavior and typed Control Plane authority remain unchanged except for adding the new conversation/model surfaces.
- Do not claim PostgreSQL, OAuth, or real-process acceptance without running the required environment-gated commands.

---

## Mandatory adversarial-review amendments

The following contract details are binding and override any earlier abbreviated task wording. Do not begin provider/runtime implementation until these are represented in tests and types.

### Locked execution contracts

1. `ModelTurnRequest` must include `requestId`, immutable `sessionId`/`turnId`, bounded `TurnLimits`, normalized messages/tools, an `AbortSignal`, and an event sink. `TurnLimits` must cap model turns, tool calls, child calls, output tokens, input/output bytes, provider time, and total wall time. `ModelToolCall` must contain a verified call ID, name, and `unknown` arguments; tool results must be a distinct origin/trust-labelled message.
2. `ModelProviderPort.cancel(requestId, signal)` returns a typed outcome: `"confirmed" | "requested" | "unsupported" | "unknown"`; request IDs are namespaced by provider instance and never reused after restart. Provider events normalize text deltas, proposed/validated/executing/completed/rejected tool calls, usage, errors, and one terminal event.
3. Runtime cancellation has explicit phases: `queued`, `provider_turn`, `tool_executing`, and `terminal`. Cancellation checks run before each tool. A non-interruptible external effect that already started yields `unknown`, never `cancelled`.
4. `ToolContext` is host-owned and immutable: operator, project, Goal, conversation, turn, session version, controller-policy hash, capability grant, outbound-data policy, and idempotency identity. The model cannot supply or override any of these fields. No model receives a bearer token or approval authority.
5. Child invocation is host-created and durably bound to parent. Its grant is the intersection of parent/Mission Bundle/tool/path/data/network/model/budget/depth/worker limits. Child cancellation cascades and child messages are bounded and recorded.
6. Root conversations use a named controller profile with a durable/persisted policy hash and allowed provider-qualified models. `MAESTRO_MODEL_ID` is only a default. Worker, Head, semantic review, Encore, and helper paths all carry and enforce model policy; actual provider/model identity is captured before/with admission and durably recorded.
7. The authenticated conversation API is explicit: `POST /v1/projects/:projectId/goals/:goalId/conversations`, `POST .../conversations/:conversationId/turns`, `GET .../conversations/:conversationId`, `GET .../conversations/:conversationId/stream?after=`, and `POST .../turns/:turnId/cancel`. Mutations require idempotency keys; turns are serialized by durable version; route IDs are authoritative over model arguments.
8. Add migrations for conversations, turns, invocations, tool calls, event cursors, provider bindings, model identity, and idempotency/quota claims. A process-local map is not sufficient for reconnect/recovery/evidence. Conversation reads need project membership and Goal binding; only effectful operations require the existing Goal lease, with lease expiry producing explicit unknown where an effect is ambiguous.
9. Provider auth is a plugin capability, not an inference boolean. `openai` API key and `openai-codex` ChatGPT subscription are distinct. ChatGPT subscription must use a documented/official Codex app-server managed-login boundary, preferably a least-privilege local sidecar; never send a ChatGPT token to public OpenAI Responses or copy Prime's private backend flow. `anthropic` API key is supported. Claude Pro/Max subscription OAuth is not enabled without written Anthropic approval; do not transplant Prime's private headers/scopes/identity claim.
10. Provider adapters are external data sinks. Enforce typed outbound data class/retention/training/region policy, redact secrets, bound context/tool output, and reject incompatible providers. Subscription quota/extra-usage warnings are explicit; provider refusal stops execution.
11. Durable quotas cap requests, concurrent turns, provider turns, tool calls, child calls, tokens/bytes, wall time, and known cost. Retries reuse the same admission identity. Stable API errors distinguish provider unavailable/auth, model not allowed, capability unavailable, rate limited, turn conflict, invocation unknown, and external effect unknown; none map to database outage.
12. Skills, paths, environment, authority, and data fields cannot be silently ignored. The native runtime either enforces them through host registries or rejects the request as unsupported.
13. The provider SDK/credential boundary is a separate `apps/model-gateway` process. Control Plane owns `ModelGatewayPort` client/RPC only; the gateway owns `ModelProviderPort`, provider SDKs, API keys, OAuth refresh, and app-server pairing. The RPC is authenticated, narrow, and cannot invoke Maestro tools or persistence.
14. `SpawnRequest` carries immutable host-created `InvocationContext`, `CapabilityGrant`, canonical `modelPolicy`, and `idempotencyKey`; a closure/default config is not a substitute. `CapabilityGrant` contains parent ID, allowed tools/skills/models/path/data classes, and decrementing model/tool/child/token/time/retry counters. Child admission atomically decrements the parent counter and persists the child grant.
15. Every normalized tool call has an idempotency key derived from Maestro invocation + provider turn + tool-call ID. Persist the claim and canonical argument hash before effect. A replay with identical arguments returns the recorded result; a reused ID with different arguments is rejected.
16. Prime removal includes workspace references, transitive lockfile packages, `primeAgentVersion`, README/.env/security/setup docs, and Prime-specific live tests. The final gate is a no-Prime dependency/source scan plus fresh build/check evidence.

## File Map

### New files

- `packages/agent-runtime/package.json` — native runtime package metadata.
- `packages/agent-runtime/tsconfig.json` — project reference and strict compiler settings.
- `packages/agent-runtime/src/model-provider.ts` — provider-neutral model turn, tool-call, usage, capability, cancellation, limits, and gateway contracts.
- `packages/agent-runtime/src/provider-registry.ts` — allowlisted provider registration, lookup, model catalog, and capability negotiation.
- `apps/model-gateway/src/credential-store.ts` — gateway-only process-local/OS-backed credential handles and provider account binding.
- `packages/agent-runtime/src/agent-runtime.ts` — native `ExecutionKernelPort` implementation and bounded model/tool/child loop.
- `packages/agent-runtime/src/grants.ts` — immutable invocation context, decrementing capability grants, and subset/atomic-child-admission rules.
- `packages/agent-runtime/src/tool-registry.ts` — strict Tool definitions, capability checks, and host-side execution.
- `packages/agent-runtime/src/index.ts` — package exports.
- `packages/model-provider-openai/package.json` — OpenAI provider plugin metadata and direct SDK dependency.
- `packages/model-provider-openai/tsconfig.json` — provider project configuration.
- `packages/model-provider-openai/src/index.ts` — OpenAI API-key provider registration and Responses adapter.
- `packages/model-provider-openai/src/codex-app-server.ts` — official Codex app-server managed-login/transport adapter with no credential forwarding.
- `packages/model-provider-openai/src/provider.test.ts` — OpenAI contract tests with a fake fetch transport.
- `packages/model-provider-anthropic/package.json` — Anthropic provider plugin metadata and direct SDK dependency.
- `packages/model-provider-anthropic/tsconfig.json` — provider project configuration.
- `packages/model-provider-anthropic/src/index.ts` — Anthropic API-key provider registration and Messages adapter.
- `packages/model-provider-anthropic/src/provider.test.ts` — Anthropic API-key contract tests with a fake fetch transport and explicit subscription-unavailable policy test.
- `apps/model-gateway/package.json` and `apps/model-gateway/tsconfig.json` — isolated provider gateway process.
- `apps/model-gateway/src/main.ts` — gateway composition and secret-store ownership.
- `apps/model-gateway/src/rpc.ts` — authenticated narrow discovery/admission/turn/cancel/recovery/auth RPC.
- `apps/model-gateway/src/rpc.test.ts` — pairing, capability, redaction, and compromised-adapter isolation tests.
- `apps/control-plane/src/conversation-service.ts` — authenticated natural-language conversation orchestration.
- `apps/control-plane/src/conversation-route.test.ts` — route/auth/validation/approval boundary tests.
- `apps/cli/src/conversation.test.ts` — CLI parity tests for natural-language conversation/model selection.
- `apps/cli/src/tui/session.test.ts` — versioned non-secret provider/model/account/conversation persistence tests.
- `packages/contracts/src/conversation.ts` — conversation request/response/model/auth schemas exported from contracts.
- `packages/api-client/src/conversation.ts` — typed conversation/model/auth client methods.
- `packages/persistence/migrations/0064_native_agent_runtime.sql` — durable controller, conversation, invocation, event, binding, idempotency, grant, and quota records.
- `packages/persistence/src/conversation.ts` and `packages/persistence/src/quota.ts` — durable conversation/cursor/idempotency/quota service seams.

### Existing files to modify

- `package.json` and `package-lock.json` — workspace references and dependency graph.
- `tsconfig.json` — project references for new packages; remove Prime project reference.
- `apps/control-plane/package.json` — replace Prime dependency with native runtime and provider plugins.
- `apps/control-plane/src/config.ts` — provider registry/model/auth configuration; remove `primeAgentVersion`.
- `apps/control-plane/src/main.ts` — compose native runtime and explicit provider registry; remove `createPrimeExecutionKernel`.
- `apps/control-plane/src/server.ts` — register authenticated conversation/model routes.
- `apps/control-plane/src/worker-service.ts` — pass explicit model policy/selection into provider-neutral worker admission.
- `packages/domain/src/execution-kernel.ts` — add canonical model policy to `SpawnCapabilities` or `SpawnRequest` without provider SDK types.
- `packages/domain/src/mission-bundle.ts` — validate canonical provider-qualified model references.
- `packages/persistence/src/worker.ts` — enforce selected model against the Mission Bundle allowlist before external spawn and record model identity/binding.
- `packages/prime-adapter/*` — delete after migration; migrate useful contract tests to native runtime tests.
- `apps/control-plane/src/*.test.ts`, `apps/device-agent/src/*.test.ts`, and other config fixtures — remove `primeAgentVersion` and use native runtime test injection.
- `apps/cli/src/main.ts` and TUI command files — add conversation/model/auth commands while preserving existing typed commands.
- `findings.md`, `progress.md`, and `task_plan.md` — append implementation evidence after each verified slice.

---

## Task 1: Add provider-neutral model and credential contracts

**Files:**
- Create: `packages/agent-runtime/package.json`
- Create: `packages/agent-runtime/tsconfig.json`
- Create: `packages/agent-runtime/src/model-provider.ts`
- Create: `packages/agent-runtime/src/index.ts`
- Modify: `package.json`, `tsconfig.json`
- Test: `packages/agent-runtime/src/model-provider.test.ts`

**Interfaces:**
- Consumes: `@maestro/domain` model identity and execution references.
- Produces: `ModelProviderPort`, `ModelProviderPlugin`, `ProviderCapability`, `ProviderDataPolicy`, `ModelCatalogEntry`, `ModelTurnRequest`, `ModelTurnResult`, `ProviderCancellationOutcome`, normalized role/tool-result messages, and typed `ModelToolCall` arguments for Tasks 2–7. Credential values are gateway-only and are not a Task 1 runtime contract.

- [ ] **Step 1: Write failing contract tests**

Create tests asserting:

```ts
it("preserves normalized assistant/tool call IDs and rejects malformed arguments", () => {
  const message = normalizeToolCall({ id: "call-1", name: "read_goal", arguments: "{" });
  expect(message).toEqual({ id: "call-1", name: "read_goal", arguments: { state: "invalid", raw: "{", reason: "malformed-json" } });
});

it("preserves deterministic order for multiple tool calls and tool results", () => {
  expect(normalizeMessages([toolCall("call-1"), toolCall("call-2")]).map((item) => item.id)).toEqual(["call-1", "call-2"]);
});

it("rejects a provider adapter with a duplicate provider ID", () => {
  const registry = new ProviderRegistry();
  registry.register(fakePlugin("openai"));
  expect(() => registry.register(fakePlugin("openai"))).toThrow("duplicate provider id");
});

it("never exposes raw credentials through a credential binding", async () => {
  const store = new InMemoryCredentialStore();
  const binding = await store.bind({ operatorId: "operator-1", providerId: "openai-codex", accountId: "account-1" }, "secret");
  expect(binding).toEqual({ operatorId: "operator-1", providerId: "openai-codex", accountId: "account-1" });
  expect(JSON.stringify(binding)).not.toContain("secret");
  expect(store.rawSecretForTest()).toBe("secret");
});
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run: `npm test -- packages/agent-runtime/src/model-provider.test.ts`

Expected: FAIL because the new package/contracts do not exist.

- [ ] **Step 3: Implement the minimal contracts**

Define provider-neutral types with these required semantics:

```ts
export type ProviderCapability =
  | "text"
  | "tool-calls"
  | "streaming"
  | "usage"
  | "cancellation"
  | "oauth";

export interface TurnLimits {
  maxModelTurns: number;
  maxToolCalls: number;
  maxChildCalls: number;
  maxOutputTokens: number;
  maxInputBytes: number;
  maxResultBytes: number;
  providerTimeoutMs: number;
  wallTimeMs: number;
}

export interface ModelTurnRequest {
  requestId: string;
  sessionId: string;
  turnId: string;
  messages: readonly ModelMessage[];
  tools: readonly ModelToolDefinition[];
  limits: TurnLimits;
  signal: AbortSignal;
  emit(event: ModelStreamEvent): void;
}

export interface ModelTurnResult {
  requestId: string;
  model: ModelIdentity;
  text: string;
  toolCalls: readonly ModelToolCall[];
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "max_turns" | "cancelled" | "error";
  usage: InvocationUsage;
}

export type ToolArguments =
  | { state: "valid"; value: unknown }
  | { state: "invalid"; raw: string; reason: "malformed-json" | "not-an-object" };

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: ToolArguments;
}

export interface ModelToolResultMessage {
  role: "tool";
  toolCallId: string;
  status: "ok" | "error" | "unknown";
  content: string;
  origin: "host";
  trust: "untrusted-data";
}

export interface ProviderCancellationOutcome {
  state: "confirmed" | "requested" | "unsupported" | "unknown";
  providerRequestRef?: string;
}

export interface ModelProviderPort {
  readonly identity: ModelIdentity;
  readonly capabilities: ReadonlySet<ProviderCapability>;
  turn(request: ModelTurnRequest): Promise<ModelTurnResult>;
  cancel(requestId: string, signal?: AbortSignal): Promise<ProviderCancellationOutcome>;
  close(): Promise<void>;
}

Keep credential values out of the public binding type. Define provider plugin creation and auth methods so only the plugin sees a `SecretValue` in memory.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm test -- packages/agent-runtime/src/model-provider.test.ts && npm run build`

Expected: PASS for the new contract tests; existing build remains green.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json packages/agent-runtime
git commit -m "feat(runtime): add provider-neutral model contracts"
```

---

## Task 2: Build the allowlisted ProviderRegistry and credential boundary

**Files:**
- Create: `packages/agent-runtime/src/provider-registry.ts`
- Create: `apps/model-gateway/src/credential-store.test.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Test: `packages/agent-runtime/src/provider-registry.test.ts`

**Interfaces:**
- Consumes: Task 1 provider/plugin and credential contracts.
- Produces: `ProviderRegistry`, `ProviderPlugin`, `ProviderModelRequest`, `ProviderAuthMode`, `CredentialStore`, and provider capability checks for Tasks 3–7.

- [ ] **Step 1: Write failing registry/auth tests**

Cover:

```ts
it("rejects an unknown provider instead of falling back", () => {
  expect(() => registry.resolve({ providerId: "not-registered", modelId: "x" })).toThrow("unknown provider");
});

it("keeps API-key and OAuth provider IDs distinct", () => {
  registry.register(fakePlugin("openai"));
  registry.register(fakePlugin("openai-codex"));
  expect(registry.resolve({ providerId: "openai" }).authModes).toEqual(["api-key"]);
  expect(registry.resolve({ providerId: "openai-codex" }).authModes).toEqual(["oauth"]);
});

it("rejects a requested capability the provider does not declare", () => {
  expect(() => registry.requireCapabilities(fakePlugin("text-only"), ["tool-calls"])).toThrow("unsupported capability");
});

it("rejects a provider whose retention or data classes violate the bound Goal policy", () => {
  expect(() => registry.requireDataPolicy(fakePlugin("training-provider"), { allowedDataClasses: ["workspace"], retention: "none", allowTraining: false, region: "us" })).toThrow("data policy");
});
```

- [ ] **Step 2: Run tests to verify red**

Run: `npm test -- packages/agent-runtime/src/provider-registry.test.ts apps/model-gateway/src/credential-store.test.ts`

Expected: FAIL on missing registry and credential boundary behavior.

- [ ] **Step 3: Implement registry and credential boundary**

Implement explicit static registration:

```ts
export interface ProviderDataPolicy {
  readonly allowedDataClasses: readonly ("public" | "workspace" | "private" | "pii" | "phi" | "secret")[];
  readonly retention: "none" | "provider-policy" | "durable";
  readonly trainsOnCustomerData: boolean;
  readonly regions: readonly string[];
}

export interface ProviderPlugin {
  readonly id: string;
  readonly authModes: readonly ProviderAuthMode[];
  readonly capabilities: ReadonlySet<ProviderCapability>;
  readonly dataPolicy: ProviderDataPolicy;
  listModels(): readonly ModelCatalogEntry[];
  create(request: ProviderModelRequest): Promise<ModelProviderPort>;
  auth?: ProviderAuthPlugin;
}

export class ProviderRegistry {
  register(plugin: ProviderPlugin): void;
  resolve(ref: { providerId: string; modelId?: string }): ProviderPlugin;
  requireCapabilities(plugin: ProviderPlugin, required: readonly ProviderCapability[]): void;
}
```

Use static allowlisted registrations in the composition root. Do not import modules from model output or arbitrary config paths. Add an in-memory credential implementation for unit tests and an OS-backed/process-local implementation seam for production. Store only opaque account/binding metadata outside the provider plugin.

- [ ] **Step 4: Verify tests and build**

Run: `npm test -- packages/agent-runtime/src/provider-registry.test.ts apps/model-gateway/src/credential-store.test.ts && npm run build`

Expected: PASS with duplicate/unknown/capability/auth-boundary cases covered.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime/src/provider-registry.ts packages/agent-runtime/src/index.ts apps/model-gateway/src/credential-store.ts apps/model-gateway/src/credential-store.test.ts packages/agent-runtime/src/*.test.ts
git commit -m "feat(runtime): add provider registry and credential boundary"
```

---

## Task 3: Add provider plugins with API-key and gated subscription authentication

**Files:**
- Create: `packages/model-provider-openai/package.json`, `packages/model-provider-openai/tsconfig.json`
- Create: `packages/model-provider-openai/src/index.ts`, `packages/model-provider-openai/src/codex-app-server.ts`, `packages/model-provider-openai/src/provider.test.ts`
- Create: `packages/model-provider-anthropic/package.json`, `packages/model-provider-anthropic/tsconfig.json`
- Create: `packages/model-provider-anthropic/src/index.ts`, `packages/model-provider-anthropic/src/provider.test.ts`
- Modify: `package.json`, `tsconfig.json`, `package-lock.json`

**Interfaces:**
- Consumes: Task 1 normalized model/provider contract and Task 2 registry/auth seams.
- Produces: `createOpenAiPlugin()`, `createAnthropicPlugin()`, API-key credential resolvers, a gated `openai-codex` app-server integration, and normalized Responses/Messages tool-call behavior. No Anthropic Pro/Max OAuth code is produced without written Anthropic approval.

- [ ] **Step 1: Write failing shared provider contract vectors plus adapter tests**

Create one reusable `runProviderContractSuite(factory)` and run it for every registered API-key and Codex app-server adapter. Use fake fetch/HTTP/RPC transports and assert:

```ts
it("normalizes an OpenAI Responses tool call without executing it", async () => {
  const provider = await createOpenAiPlugin({ transport: fakeOpenAiToolCallTransport() }).create(apiKeyRequest("openai", "gpt-test"));
  const result = await provider.turn(requestWithTool("read_goal"));
  expect(result.toolCalls).toEqual([{ id: "call-1", name: "read_goal", arguments: { goalId: "goal-1" } }]);
});

it("normalizes an Anthropic tool_use block", async () => {
  const provider = await createAnthropicPlugin({ transport: fakeAnthropicToolCallTransport() }).create(apiKeyRequest("anthropic", "claude-test"));
  const result = await provider.turn(requestWithTool("read_goal"));
  expect(result.toolCalls[0]?.name).toBe("read_goal");
});

it("uses only the documented Codex app-server managed-login and event boundary", async () => {
  const gateway = await createCodexAppServerGateway(fakeManagedLoginServer());
  expect(gateway.authMode).toBe("chatgpt-subscription");
  expect(gateway.sentCredentials).toEqual([]);
  expect(await gateway.listModels()).toEqual(["openai-codex/gpt-test"]);
});

it.each([
  ["replayed pairing nonce", { nonce: "used", used: true }],
  ["wrong operator", { operatorId: "operator-2" }],
  ["wrong provider", { providerId: "anthropic" }],
  ["wrong callback host", { host: "0.0.0.0" }],
  ["wrong callback port", { port: 1 }],
])("rejects %s in the gateway pairing response", async (_label, response) => {
  await expect(gatewayPairing.complete(response)).rejects.toThrow();
  expect(fakeCredentialStore.values()).toEqual([]);
});
```

Also cover API-key resolution, normalized multi-call/malformed tool arguments, Codex app-server managed-login pairing/event/error contract, single-use nonce/operator/provider/session/host/port binding exposed by the gateway, account binding, quota/extra-usage diagnostics, and redaction of provider response bodies. Explicitly test that `anthropic-oauth` is unavailable without written provider approval and that no Maestro code requests or handles broad Prime OAuth scopes.
The shared vectors also require ordered text deltas, multi-call correlation, proposed/validated/executing/completed/rejected events, usage, typed auth/quota/transport errors, exactly one terminal event, rejection of duplicate/missing terminal events, malformed deltas, call-ID reuse, cancellation races, secret-bearing error bodies, and provider/account identity mismatch.

- [ ] **Step 2: Run provider tests and verify red**

Run: `npm test -- packages/model-provider-openai/src/provider.test.ts packages/model-provider-anthropic/src/provider.test.ts`

Expected: FAIL because provider packages/adapters do not exist.

- [ ] **Step 3: Implement API-key adapters**

Use the official SDKs only inside provider packages. Normalize:

- text deltas/final text;
- OpenAI `function_call`/Responses tool items and Anthropic `tool_use` blocks;
- provider usage into `InvocationUsage`;
- `AbortSignal` and provider cancellation;
- provider/model identity;
- retryable transport errors versus authentication/quota errors.

Do not retry a non-idempotent Tool call after provider admission unless the same request ID is proven safe.

- [ ] **Step 4: Implement gated subscription integrations**

Implement `openai-codex` only as an adapter around the documented Codex app-server managed-login boundary. The app-server owns OAuth refresh and subscription transport; Maestro receives normalized text/tool/events and an opaque account reference over an authenticated least-privilege local channel. Disable or reject app-server built-in shell/file/MCP/approval tools so only Maestro ToolRegistry tools are exposed.

Do not implement `anthropic-oauth` by copying Prime Agent. Register it as unavailable with a stable provider-policy error until written Anthropic approval and a supported third-party protocol are recorded. Never request `org:create_api_key`, MCP-server, or file-upload scopes for Maestro.

For every auth mode, redact tokens and callback URLs, enforce account/operator binding, and keep refresh state in the provider gateway/keyring.

- [ ] **Step 5: Run provider contract tests and build**

Run: `npm test -- packages/model-provider-openai/src/provider.test.ts packages/model-provider-anthropic/src/provider.test.ts && npm run build`

Expected: PASS for fake transport/OAuth tests; real credential tests remain environment-gated.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json packages/model-provider-openai packages/model-provider-anthropic
git commit -m "feat(provider): add pluggable openai and anthropic adapters"
```

---

## Task 4: Implement the native MaestroAgentRuntime and common Tool/child loop

**Files:**
- Create: `packages/agent-runtime/src/tool-registry.ts`
- Create: `packages/agent-runtime/src/skill-registry.ts`
- Create: `packages/agent-runtime/src/agent-runtime.ts`
- Create: `packages/agent-runtime/src/agent-runtime.test.ts`
- Create: `packages/agent-runtime/src/agent-runtime.contract.test.ts`
- Modify: `packages/agent-runtime/src/index.ts`, `packages/domain/src/execution-kernel.ts`

**Interfaces:**
- Consumes: Tasks 1–3 provider/registry contracts and existing `ExecutionKernelPort`.
- Produces: `createMaestroAgentRuntime(options): ExecutionKernelPort`, `ToolRegistry`, `ToolDefinition`, `ToolExecutor`, and contract-tested normalized root/child execution.

- [ ] **Step 1: Write failing runtime contract tests**

Cover:

```ts
it("executes a normalized tool call only through the registered host executor", async () => {
  const runtime = createMaestroAgentRuntime(fakeRuntimeOptions({ provider: scriptedProvider([toolCall("read_goal")]) }));
  const { execution, invocation } = await runtime.spawn(rootRequest({ allowedTools: ["read_goal"] }));
  await runtime.prompt(execution, "show the Goal");
  expect(await runtime.getInvocationStatus(invocation)).toBe("succeeded");
  expect(fakeToolExecutor.calls).toEqual([{ name: "read_goal", args: expect.anything() }]);
});

it("rejects an unregistered or out-of-scope tool call", async () => {
  const result = await runScriptedTurn([toolCall("write_secret", { path: "/outside" })], { allowedTools: ["read_goal"] });
  expect(result.status).toBe("failed");
  expect(fakeToolExecutor.calls).toEqual([]);
});

it("creates a child with narrowed capabilities and never widens the parent grant", async () => {
  const child = await runtime.spawn(childRequest({ allowedTools: ["read_goal", "read_events"], modelPolicy: ["anthropic/claude-test"] }));
  expect(child.grant.allowedTools).toEqual(["read_goal"]);
  expect(child.modelPolicy).toEqual(["anthropic/claude-test"]);
});

it("stops after the configured model-turn and tool-call limits", async () => {
  const result = await runScriptedLoop(repeatingToolCall("read_goal"), { maxModelTurns: 2, maxToolCalls: 3 });
  expect(result.stopReason).toBe("max_turns");
});

it("does not claim cancellation success when an external tool effect is unproven", async () => {
  const result = await cancelDuringToolExecution({ effectOutcome: "unknown" });
  expect(result.status).toBe("unknown");
});
```

Include prompt injection in user text, Goal brief, project metadata, profile/skill content, and tool results; include model-returned route/actor/Goal arguments. Assert none can register a new tool, change the Goal/project, invoke an arbitrary endpoint, read a secret, or bypass approval. Add canary-secret and oversize-result tests.
Run the reusable `ExecutionKernelPort` contract suite against the native runtime. It must cover `spawn`, `prompt`, `observe`, `sendMessage`, `getModelIdentity`, `getToolEvents`, `getUsage`, `getInvocationStatus`, `cancel`, `release`, `close`, `resume`, and `reconnect`; verify terminal release only after durable acknowledgement, close-drain behavior, observation `unavailable` semantics, restart recovery to `reconnected`/`terminal`/`unknown`, fencing after unknown, and no duplicate effect.
Also assert a duplicate tool call with identical arguments replays its recorded result, while a duplicate call ID with different arguments is rejected; the claim/result is persisted before effect. Verify a provider with incompatible retention/training/region policy is rejected, and that the outbound policy hash cannot change for an in-flight invocation.

- [ ] **Step 2: Run the runtime tests and verify red**

Run: `npm test -- packages/agent-runtime/src/agent-runtime.test.ts`

Expected: FAIL because the native runtime and tool registry do not exist.

- [ ] **Step 3: Extend the provider-neutral request with explicit model policy**

Add canonical provider-qualified model policy plus immutable `InvocationContext`, `CapabilityGrant`, lease/fencing binding, and idempotency key. `CapabilityGrant` contains parent ID, allowed tools/skills/models/path/data classes, and remaining model-turn/tool-call/child-call/token/time/retry counters. Child admission atomically decrements the parent counter and persists the child grant. The request contains no SDK types or credentials, and model text cannot set these fields. Preserve existing test injection of `ExecutionKernelPort`. Define typed `RecoveryResult` and update `resume`/`reconnect` return types so durable gateway binding can return `reconnected`, `terminal`, or `unknown`.

- [ ] **Step 4: Implement ToolRegistry and host-side policy checks**

Each tool has a stable name/version, strict Zod input/output schemas, read/mutation classification, capability requirement, outbound data class, fixed Control Plane service/action, and host executor. Expose narrow handlers such as `readGoal`, `readEvents`, `createOrdinaryObject`, and `requestCriticalApproval`; never expose a generic endpoint/path client, auth/admin/conversation/self-approval tool, bearer token, or model-selected route IDs. The executor receives immutable `InvocationContext`/`ToolContext` from the Control Plane service. Before serializing a result into provider messages, enforce Mission Bundle `dataBoundary`/`externalServiceBoundary`, redact secrets/PII/PHI, cap bytes/depth, and label untrusted content. A model tool call is data until schema, fixed-action scope, lease, fencing, idempotency, and durable-approval checks pass.

- [ ] **Step 5: Implement root/child turn loop**

The runtime creates opaque Maestro execution/invocation refs, sends normalized turns to the selected provider, and enforces `TurnLimits` before every provider turn, tool call, and child admission. Each tool call derives an idempotency key from invocation/turn/call ID, persists an argument hash and claim before effect, returns the recorded result on identical replay, and rejects a different replay. It creates child sessions with narrowed decrementing grants, normalizes status/answer/usage/tool activity, and records unknown on ambiguous provider failure. Child IDs never cross the authority boundary.

- [ ] **Step 6: Implement cancellation, release, and close**

Use per-request `AbortController`s. Mark cancellation intent before provider cancellation. Do not release in-memory state until the caller confirms durable terminal recording. Stop new admissions and drain active requests within configured timeout.

- [ ] **Step 7: Run focused tests and build**

Run: `npm test -- packages/agent-runtime/src/agent-runtime.test.ts && npm run build`

Expected: PASS for runtime contract tests and no regression in existing packages.

- [ ] **Step 8: Commit**

```bash
git add packages/agent-runtime packages/domain/src/execution-kernel.ts
git commit -m "feat(runtime): add native maestro agent execution"
```

---

## Task 5: Enforce model authorization and remove Prime Agent composition

**Files:**
- Modify: `packages/domain/src/mission-bundle.ts`, `packages/contracts/src/index.ts`
- Modify: `packages/persistence/src/worker.ts`, `packages/persistence/src/head-participation.ts`, `packages/persistence/src/semantic-review.ts`, `packages/persistence/src/encore-council.ts`, `apps/control-plane/src/worker-service.ts`
- Create: `packages/persistence/migrations/0064_native_agent_runtime.sql`
- Modify: `apps/control-plane/src/config.ts`, `apps/control-plane/src/main.ts`, `apps/control-plane/package.json`
- Modify: `package.json`, `package-lock.json`, `tsconfig.json`
- Delete: `packages/prime-adapter/*`
- Test: existing worker/config/main integration tests plus new model authorization tests

**Interfaces:**
- Consumes: Task 4 native runtime and Tasks 2–3 provider registry/plugins.
- Produces: production Control Plane composition with no Prime dependency and exact provider-qualified model admission.

- [ ] **Step 1: Write failing model authorization/removal tests**

Add tests asserting:

```ts
it("rejects a selected model not present in the Mission Bundle approvedModels", async () => {
  await expect(admitWorker({ modelRef: "test/not-approved" })).rejects.toThrow("model_not_allowed");
  expect(fakeKernel.spawn).not.toHaveBeenCalled();
});

it("records the actual provider/model identity returned by the native runtime", async () => {
  await admitWorker({ modelRef: "test/model-a" });
  expect(await evidenceStore.last().model).toEqual({ provider: "test", id: "model-a" });
});

it("does not construct a provider when provider ID is unknown", () => {
  expect(() => registry.resolve({ providerId: "not-registered", modelId: "x" })).toThrow("provider");
  expect(providerFactory.calls).toEqual([]);
});

it("parses model/auth config without retaining raw secrets in redacted config", () => {
  const redacted = loadConfig({ OPENAI_API_KEY: "secret" }).redacted;
  expect(JSON.stringify(redacted)).not.toContain("secret");
});
```

- [ ] **Step 2: Run focused tests and verify red**

Run: `npm test -- apps/control-plane/src/config.test.ts apps/control-plane/src/worker-service.test.ts packages/persistence/src/worker-model-policy.test.ts`

Expected: FAIL until model policy is carried and Prime composition is replaced.

- [ ] **Step 3: Make model references canonical and enforce before provider admission**

Use `provider/model-id` for `approvedModels`. Add a named durable controller profile/allowlist for root conversations. Update domain/contracts fixtures from `model-a` to explicit test refs such as `test/model-a`. Resolve exactly one selected identity and reject missing/ambiguous/unapproved values before calling `kernel.spawn` or a provider plugin. Propagate the policy through Worker, Head activation, semantic review, Encore, and helper/reviewer paths.

- [ ] **Step 4: Add durable binding/evidence migration and compose native runtime**

Create durable conversation/turn/invocation/tool/event/provider-binding/idempotency/quota records. Capture the actual model identity before or atomically with each Worker/Head/reviewer admission; if identity cannot be observed, fail before external admission. Then replace Prime composition with `createMaestroAgentRuntime({ registry, ... })`.

Replace `createPrimeExecutionKernel()` in `apps/control-plane/src/main.ts` with `createMaestroAgentRuntime({ registry, ... })`. Register provider plugins explicitly. Remove `primeAgentVersion` from config and all fixtures. Preserve `ControlPlaneOverrides.executionKernel` for tests.

- [ ] **Step 5: Remove Prime package/dependency and migrate tests**

Delete the Prime adapter package and all Prime live tests. Convert useful adapter tests into native runtime/provider contract tests. Regenerate lockfile with `npm install`/`npm ci` according to repository practice, then grep source/package/lockfile for `prime-agent`, `@maestro/prime-adapter`, and `primeAgentVersion`.

- [ ] **Step 6: Run focused tests, build, and dependency audit**

Run:

```bash
npm test -- apps/control-plane/src/config.test.ts apps/control-plane/src/main.integration.test.ts packages/persistence/src/worker.integration.test.ts
npm run build
grep -RIn "prime-agent\|@maestro/prime-adapter\|primeAgentVersion\|built on Prime Agent" apps packages README.md .env.example SECURITY.md package.json tsconfig.json package-lock.json --exclude-dir=dist --exclude-dir=node_modules
```

Expected: focused tests and build pass; grep returns no production/reference occurrence except historical documentation explicitly marked as history.

- [ ] **Step 7: Commit**

```bash
git add -A
 git commit -m "refactor(control-plane): remove prime agent runtime"
```

---

## Task 6: Add authenticated natural-language conversation API

**Files:**
- Create: `packages/contracts/src/conversation.ts`
- Create: `packages/api-client/src/conversation.ts`
- Create: `apps/control-plane/src/conversation-service.ts`
- Create: `apps/control-plane/src/model-gateway-client.ts`, `apps/control-plane/src/model-gateway-client.test.ts`
- Create: `apps/control-plane/src/conversation-route.test.ts`
- Create: `packages/persistence/src/conversation.ts`, `packages/persistence/src/conversation.integration.test.ts`
- Create: `packages/persistence/src/quota.ts`, `packages/persistence/src/quota.integration.test.ts`
- Modify: `packages/persistence/migrations/0064_native_agent_runtime.sql`
- Create: `packages/persistence/src/conversation.ts`
- Create: `packages/persistence/src/conversation.integration.test.ts`
- Modify: `packages/persistence/migrations/0064_native_agent_runtime.sql`
- Modify: `packages/contracts/src/index.ts`, `packages/api-client/src/index.ts`, `apps/control-plane/src/server.ts`, `apps/control-plane/src/main.ts`

**Interfaces:**
- Consumes: Task 4 runtime/tool registry, Task 5 provider registry/config, existing authenticated route helpers.
- Produces: authenticated conversation request/response route and typed client methods used by TUI/CLI.

- [ ] **Step 1: Write failing contract/service/route tests**

Define strict schemas and tests for create/turn/read/stream/cancel/reconnect:

```ts
POST /v1/projects/:projectId/goals/:goalId/conversations
Headers: Idempotency-Key: command-1
{ "model": "openai/gpt-..." }

POST /v1/projects/:projectId/goals/:goalId/conversations/:conversationId/turns
Headers: Idempotency-Key: turn-1
{ "message": "현재 Goal 상태를 보여줘", "expectedVersion": 3 }
```

Assert project membership, Goal binding, controller-profile model authorization, conversation ownership, malformed requests, provider unavailable/auth/quota errors, idempotent replay/conflict, serialized turns, durable cursor replay without duplication, read tool execution, ordinary mutation routing, and critical-action approval-required results.

- [ ] **Step 2: Run route tests and verify red**

Run: `npm test -- apps/control-plane/src/conversation-route.test.ts`

Expected: FAIL because schemas, service, route, and client methods do not exist.

- [ ] **Step 3: Implement contracts and typed client methods**

Add strict Zod schemas and typed `ApiClient.createConversation`, `turnConversation`, `getConversation`, `streamConversation` (with `after`/`Last-Event-ID`), `cancelConversationTurn`, `reconnectConversation`, and model/provider diagnostics methods. Include `expectedVersion`, idempotency headers, cancellation outcome, terminal/unknown states, and stable error envelopes. Parse every response/event through Zod; do not collapse these methods into one untyped `converse` call.
Set Fastify/body-parser byte limits before parsing; schemas bound UTF-8 message bytes, content-part count/depth, conversation/turn counts, tool-result bytes, event size, cursor length, and JSON nesting. Reserve and charge input bytes before provider admission. Reject oversize input with a stable typed error without invoking the gateway.
The HTTP route sets a concrete body limit before parsing (configured `maxRequestBytes`), and normalized messages enforce the same UTF-8 budget after decoding. Stream events and cursors have independent maximums; quota reservations include input bytes.

- [ ] **Step 4: Implement conversation service**

Resolve the operator's provider account reference and selected model through `ModelGatewayPort`; raw credentials never enter Control Plane. Build only the allowed controller ToolRegistry for the bound project/Goal. Persist conversation/turn/invocation bindings before runtime admission, run the native runtime, and append bounded normalized events with durable cursors. Return normalized assistant text, tool activity, durable command/result references, approval-required state, provider/model identity, usage, and terminal/unknown status. Do not store raw prompts/tool results in logs by default.

- [ ] **Step 5: Add route authorization, durable quotas, and stable errors**

Use existing bearer authentication and project membership checks before runtime admission. Reserve durable per-operator/project/conversation quotas for requests, concurrent turns, model turns, tool calls, child calls, tokens/bytes, wall time, and known cost. Retries reuse the original command identity. Map provider/auth/model/capability/quota/turn-conflict/unknown outcomes to distinct stable API errors. Do not allow model arguments to override actor/project/Goal context.

- [ ] **Step 6: Run focused tests and build**

Run: `npm test -- apps/control-plane/src/conversation-route.test.ts && npm run build`

Expected: all route/security/approval tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts packages/api-client apps/control-plane/src/server.ts apps/control-plane/src/main.ts apps/control-plane/src/conversation-service.ts apps/control-plane/src/model-gateway-client.ts apps/control-plane/src/model-gateway-client.test.ts apps/control-plane/src/conversation-route.test.ts packages/persistence/src/conversation.ts packages/persistence/src/conversation.integration.test.ts packages/persistence/src/quota.ts packages/persistence/src/quota.integration.test.ts packages/persistence/migrations/0064_native_agent_runtime.sql
git commit -m "feat(control-plane): add authenticated natural language conversations"
```

---

## Task 7: Wire TUI/CLI model selection, subscription login, and natural-language flow

**Files:**
- Modify: `apps/cli/src/main.ts`, `apps/cli/src/tui/session.ts`, CLI/TUI command registry and session files found by `grep -RIn "startInteractiveTui\|slash\|autocomplete" apps/cli/src packages`
- Create: `apps/cli/src/tui/session.test.ts`
- Create/modify: CLI/TUI tests for `/model`, `/auth`, and free-text conversation.
- Modify: `docs/*` and progress evidence after verification.

**Interfaces:**
- Consumes: Task 6 typed conversation API and provider auth diagnostics.
- Produces: user-facing natural-language control, `/model use`, `/model list`, `/auth login`, `/auth logout`, and truthful unavailable/setup states.

- [ ] **Step 1: Write failing TUI/CLI tests**

Cover:

```ts
it("routes free text to the authenticated conversation API", async () => {
  await input("show the Goal");
  expect(apiClient.converse).toHaveBeenCalledWith(projectId, goalId, expect.objectContaining({ message: "show the Goal" }));
});
it("stores only non-secret provider/model/account/conversation metadata", async () => {
  await session.save({ model: "openai/gpt-test", authMode: "api-key", accountRef: "acct-1", conversationId: "conv-1", cursor: 4 });
  const raw = await filesystem.readFile(session.path, "utf8");
  expect(raw).not.toContain("access-token");
  expect(JSON.parse(raw).version).toBe(2);
});
it("starts a new conversation when changing model and leaves existing binding immutable", async () => {
  await input("/model use anthropic/claude-test");
  expect(session.conversationId).not.toBe(previousConversationId);
  expect(apiClient.changeConversationModel).not.toHaveBeenCalled();
});
it("reports subscription login required without printing a token", async () => {
  await input("/auth login anthropic-oauth");
  expect(screen.text()).toContain("provider-policy-unavailable");
  expect(screen.text()).not.toContain("access-token");
});
it("does not disable natural language when Prime Agent is absent", async () => {
  expect(commandRegistry.freeTextHandler).toBeDefined();
});
```

- [ ] **Step 2: Run focused tests and verify red**

Run: `npm test -- apps/cli/src/*conversation* apps/cli/src/*model*`

Expected: FAIL until commands and free-text routing are wired.

- [ ] **Step 3: Implement typed model/auth command handlers**

Add `/model list`, `/model use <provider>/<model>`, `/model status`, `/auth login <provider>`, and `/auth logout <provider>`. Version and validate `WorkspaceSession`; persist workspace/project/Goal, conversation ID/version/cursor, provider-qualified model, auth mode, and opaque account reference only. API-key setup reports gateway environment/keyring status without exposing values. OpenAI subscription login delegates to the explicit local Codex app-server gateway. Claude Pro/Max subscription login reports a stable provider-policy-unavailable state unless written Anthropic approval is present. Never print secrets or callback tokens. Model changes start a new conversation or an explicitly authorized new turn; they never rewrite an existing binding.

- [ ] **Step 4: Route free text through the conversation API**

Keep slash commands as deterministic typed paths. Treat other input as conversation text. Reuse selected project/Goal context, send it to the authenticated backend, consume the typed SSE stream with `Last-Event-ID` reconnect (or typed status polling when SSE is unavailable), and show approval-required/unavailable/provider-auth/unknown states without fabricating success. Disconnect never cancels the server turn.

- [ ] **Step 5: Run focused tests/build and manual no-credential smoke**

Run:

```bash
npm test -- apps/cli/src
npm run build
npm run cli -- --help
```

Run the existing bare-TUI smoke without provider credentials and verify setup-required/provider-unavailable output is explicit.

- [ ] **Step 6: Commit**

```bash
git add apps/cli docs
 git commit -m "feat(cli): add provider-aware natural language control"
```

---

## Task 8: Provider/runtime contract, OAuth, PostgreSQL, and real-process acceptance

**Files:**
- Modify/add focused contract and integration tests across `packages/agent-runtime`, provider packages, `apps/control-plane`, `packages/persistence`, and CLI/TUI.
- Modify: `findings.md`, `progress.md`, `task_plan.md` with evidence only after each gate.

**Interfaces:**
- Consumes: Tasks 1–7 complete implementation.
- Produces: evidence-backed release decision; no completion claim without all required gates.

- [ ] **Step 1: Run all provider contract tests for every registered provider/auth variant**

Run the exact focused suites for API-key adapters and the documented Codex app-server pairing/event boundary with fake transports. Verify capability/data-policy declarations, malformed and multi-call provider responses, quota/extra-usage errors, typed cancellation outcomes, exact model/account identity, pairing nonce/operator/session/provider/host/port binding, and secret redaction. Anthropic subscription remains an explicit policy-unavailable result without written approval.

- [ ] **Step 2: Run the full no-credential repository check**

Run: `npm run check`

Record pass/skip/failure counts. Any test failure is fixed before proceeding; environment-gated skips remain explicitly documented.

- [ ] **Step 3: Run disposable PostgreSQL integration suites**

Set `MAESTRO_TEST_DATABASE_URL` to the assigned disposable database and run the repository's full PostgreSQL command. Verify model policy, conversation route, durable approval, worker lease/fencing, idempotency, and evidence identity.

- [ ] **Step 4: Run provider-process and recovery tests**

Run API-key adapters in the Control Plane with fake/recorded transports. Where OpenAI subscription is enabled, start the official Codex app-server as a separate least-privilege local process and exercise managed login, normalized events, disabled built-in tools, and authenticated pairing. Do not run or claim Anthropic subscription OAuth without written provider approval. Kill/restart the Control Plane during a running native invocation and verify durable binding, `unknown`/fencing behavior, no duplicate effect, and reconnect cursor behavior.

- [ ] **Step 5: Run security, outbound-data, quota, and dependency checks**

Inspect provider request payloads for secret/PHI leakage, verify typed outbound data policy and provider retention capability, exercise quota exhaustion and retry identity reuse, and confirm callback/state/token redaction.

Run `npm audit` using repository policy, inspect the diff for secret/log leakage, grep for Prime references, and review OAuth callback binding, state/PKCE, rate limits, account attribution, and model allowlist enforcement.

- [ ] **Step 6: Independent no-edit review**

Have a separate reviewer inspect the full diff and evidence against the spec. The implementing agent may not mark the slice accepted by self-review alone.

- [ ] **Step 7: Record final evidence and commit**

Append exact command output and remaining environmental limitations to `findings.md`/`progress.md`. Only after verification:

```bash
git diff --check
git status --short
git commit -m "test(maestro): verify native provider backend"
```

Do not push or merge without explicit user approval.
