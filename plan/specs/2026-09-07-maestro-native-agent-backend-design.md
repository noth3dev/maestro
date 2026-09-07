# Maestro Native Agent Backend Design

**Date:** 2026-09-07  
**Status:** Draft for written review; implementation direction approved in chat  
**Scope:** Remove Prime Agent and provide native model-backed agent execution

## Decision

Remove `prime-agent` and `@maestro/prime-adapter` from the production dependency graph. Maestro will own the agent runtime and will connect to providers only through a provider-neutral model port and explicit provider registry. The core runtime must not import an OpenAI, Anthropic, local-model, or other provider SDK.

The user-facing product remains one Maestro conversational control surface. The model provider is swappable. The runtime, tools, child-agent orchestration, cancellation, observation, and Control Plane boundaries are owned by Maestro.

## Goal

Support natural-language control and Worker execution with OpenAI/ChatGPT and Anthropic/Claude models while preserving the existing Maestro execution contract and safety invariants.

Representative user flows must work regardless of the selected provider:

- inspect workspace/project/Goal state;
- ask Maestro to create or change a non-critical object through the existing API;
- request a critical action and receive the durable-approval state rather than bypassing it;
- create and observe a child Worker within its explicit grant;
- cancel an in-flight invocation;
- display provider, model, usage, tool activity, terminal status, and unknown/recovery states.

## Provider scope

The first provider integrations are separate adapter modules behind the registry. The core does not depend on any provider SDK. The initial matrix is:

| Provider ID | Account/auth mode | Transport | Status boundary |
|---|---|---|---|
| `openai` | OpenAI API key | OpenAI Responses API | production candidate |
| `openai-codex` | ChatGPT Plus/Pro subscription | documented Codex app-server managed-login boundary | explicit opt-in; separate gateway and contract verification required |
| `anthropic` | Anthropic API key | Anthropic Messages API | production candidate |
| `anthropic-oauth` | Claude Pro/Max subscription | no supported third-party transport | unavailable without written Anthropic approval; never copy Prime private flow |

Local models and future providers are additional adapters. Adding one must require no change to the core runtime or Control Plane business services. Credentials remain process-local to a provider gateway and are never copied into PostgreSQL, TUI session files, Mission Bundles, or model prompts.

## Architecture

```text
TUI / CLI conversation
        |
        v
Control Plane conversation route
        |
        v
MaestroAgentRuntime
   |               |             +--> ToolRegistry / ToolExecutor
   |             +--> ChildInvocationManager
   |             +--> session/cancel/observation state
   |             +--> authenticated Maestro API and authority gateways
   v
ModelGatewayPort (authenticated narrow RPC)
   +--> model-gateway process
           +--> ProviderRegistry
                   +--> OpenAI Responses adapter
                   +--> Anthropic Messages adapter
                   +--> OpenAI Codex app-server adapter
                   +--> future provider adapters
```

The Control Plane remains the only durable authority. The runtime may call only registered host tools. It never imports persistence internals or executes arbitrary model-provided shell/filesystem/MCP operations. The model-gateway is not an authority gateway: it can perform model I/O only, and its RPC cannot invoke Maestro tools.

`ExecutionKernelPort` remains the provider-neutral boundary consumed by Worker, Encore, and lifecycle services. `MaestroAgentRuntime` is its only production implementation after Prime removal.

## Host placement and durable conversation contract

The native runtime runs inside the authenticated Control Plane process. Provider SDKs and credentials run in a separate `model-gateway` process. TUI and CLI callers use Fastify HTTP/SSE routes; the Control Plane talks to the gateway over an authenticated narrow RPC/local socket. Package boundaries are not treated as a secret boundary.

The minimum Control Plane route contract is:

```text
POST /v1/projects/:projectId/goals/:goalId/conversations
POST /v1/projects/:projectId/goals/:goalId/conversations/:conversationId/turns
GET  /v1/projects/:projectId/goals/:goalId/conversations/:conversationId
GET  /v1/projects/:projectId/goals/:goalId/conversations/:conversationId/stream?after=<cursor>
POST /v1/projects/:projectId/goals/:goalId/conversations/:conversationId/turns/:turnId/cancel
```

Every mutating request requires an idempotency key. The backend binds `operatorId`, `projectId`, `goalId`, selected model, controller-policy hash, and session version at conversation admission. A turn carries user text and an optional expected conversation version; route parameters, not model output, determine project/Goal context. Concurrent turns are serialized per conversation. Replaying an idempotency key with different content is rejected.

Conversation, turn, tool-call, event-cursor, and provider-binding metadata are durably recorded before or alongside execution. Prompt/history retention is bounded and redacted. A restart can reconnect to durable terminal/unknown state. It cannot claim to resume an in-flight provider call without a durable binding and adapter proof.

## Executable turn, tool, and event contracts

A model turn supports a bounded event sink, not only a final string:

```ts
interface ModelTurnRequest {
  requestId: string;
  sessionId: string;
  turnId: string;
  messages: readonly ModelMessage[];
  tools: readonly ModelToolDefinition[];
  limits: TurnLimits;
  signal: AbortSignal;
  emit(event: ModelStreamEvent): void;
}

interface ModelTurnResult {
  requestId: string;
  model: ModelIdentity;
  text: string;
  toolCalls: readonly ModelToolCall[];
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "max_turns" | "cancelled" | "error";
  usage: InvocationUsage;
}
```

`ModelToolCall` has a verified call ID, strict tool name, and parsed unknown arguments. The runtime caps turns, tool calls, argument/result bytes, output tokens, child depth, child count, provider requests, wall time, concurrent turns, and per-operator/project/conversation quota. Tool results are distinct data messages with origin/trust labels. Repeated call IDs, duplicate non-idempotent commands, malformed arguments, unknown tools, and repeated identical failures terminate or require explicit correction; they never loop indefinitely.
Normalized messages have roles `system`, `user`, `assistant`, `tool`, and `developer-data`; content is bounded content parts (`text`, `tool-call`, or `tool-result`) with an origin/trust label. A tool result contains `toolCallId`, `status: "ok" | "error" | "unknown"`, redacted content, and a bounded byte/depth budget. Assistant tool calls and tool results preserve call IDs and deterministic order; the runtime executes calls sequentially unless a tool explicitly declares safe parallelism. Adapters must not reconstruct calls from plain text.

Each call derives `toolIdempotencyKey = H(invocationRef, turnId, providerTurnRef, toolCallId)`. The host durably claims this key with a canonical-arguments hash before an effect. Identical replay returns the recorded result; a reused call ID/key with different arguments is rejected. Provider retries and reconnects cannot duplicate an ordinary mutation.

The model-gateway RPC carries bounded text deltas, tool-call proposal metadata, usage updates, provider errors, cancellation outcomes, and one terminal event with a cursor. Provider request/session IDs are namespaced inside the gateway and are never exposed as authority-bearing IDs.

## Delegated authority and ToolContext

Every host ToolExecutor receives an immutable context:

```ts
interface ToolContext {
  operatorId: string;
  projectId: string;
  goalId: string;
  conversationId: string;
  turnId: string;
  sessionVersion: number;
  controllerPolicyHash: string;
  capabilityGrant: readonly string[];
  outboundDataPolicyHash: string;
}
```

The model cannot set or override these fields. A mutation tool builds its typed `ActionRequest` and target from validated arguments plus this context, then rechecks membership, Goal state, lease/fencing, scope, idempotency, and approval through existing services/gateways. The model never receives a bearer token or `approve-and-run` authority.
Tools are narrow named handlers with fixed service/action mappings, not a generic API client. The initial set is `readGoal`, `readEvents`, `createOrdinaryObject`, and `requestCriticalApproval`; auth, admin, arbitrary endpoint, conversation-self-call, and self-approval tools are excluded. Model-selected route paths, actor IDs, project IDs, and Goal IDs are never forwarded as authority.

Every tool declares an outbound data class and redaction policy. Before a read or tool result is placed in provider context, the runtime intersects that class with Mission Bundle `dataBoundary`/`externalServiceBoundary`, removes secrets/PII/PHI/private content as configured, caps bytes/depth, and labels the remaining text as untrusted data. User text, Goal briefs, project metadata, profile/skill text, and tool results are all untrusted and delimited; none can change host policy.

Critical tools are split into request and human approval operations. The model may create a durable approval request bound to exact canonical arguments, command ID, project/Goal, policy version, expiry, and budget effect. Only the authenticated human approval route can approve and execute it. Effect timeout or lease expiry after admission produces `unknown` and reconciliation, not guessed success/failure.

## Root and child model policy

Every root conversation uses a named controller profile with a persisted allowed-model list and policy hash. Process configuration may select a default but cannot grant authorization. Every child/Worker/reviewer/helper spawn carries an explicit provider-qualified model policy; Head activation, semantic review, Encore, and helper paths use the same check. The selected adapter must attest to the same identity returned by `getModelIdentity`; mismatch fails closed.

Child invocations are host-created and durably bound to their parent conversation/Goal. The child grant is the intersection of parent, Mission Bundle, tool/path/data/network/model/budget/depth/worker limits. Cancellation cascades parent-to-child, and child messages use a bounded host channel. Provider-native IDs never become Maestro authority or model-visible identity.

## ModelProviderPort

The provider contract normalizes provider-specific model I/O. Provider implementations are registered at the composition boundary; the runtime resolves a provider/model profile through the registry and never imports a concrete SDK:

```ts
interface ProviderCancellationOutcome {
  state: "confirmed" | "requested" | "unsupported" | "unknown";
  providerRequestRef?: string;
}

interface ModelProviderPort {
  readonly identity: ModelIdentity;
  readonly capabilities: ReadonlySet<ProviderCapability>;
  turn(request: ModelTurnRequest): Promise<ModelTurnResult>;
  cancel(requestId: string, signal?: AbortSignal): Promise<ProviderCancellationOutcome>;
  close(): Promise<void>;
}

interface ModelGatewayPort {
  listModels(request: GatewayModelListRequest): Promise<readonly ModelCatalogEntry[]>;
  admit(request: GatewayAdmissionRequest): Promise<GatewayBinding>;
  turn(request: GatewayTurnRequest): Promise<ModelTurnResult>;
  cancel(requestId: string, signal?: AbortSignal): Promise<ProviderCancellationOutcome>;
  recover(binding: GatewayBinding): Promise<"reconnected" | "terminal" | "unknown">;
  close(): Promise<void>;
}
```

The request includes a bounded message list, normalized tool definitions, an opaque request ID, and output/turn limits. The result includes text, normalized tool calls, a continuation/terminal reason, provider usage when available, and the actual provider/model identity.

The OpenAI and Anthropic adapters translate their native tool-call, streaming, error, usage, and cancellation formats. Provider-specific types must not leak into `@maestro/domain` or `MaestroAgentRuntime`. A new adapter implements the same port, declares its capabilities, supplies its credential resolver, and passes the shared provider contract suite.

`ModelGatewayPort` is the Control Plane client contract for the separate model-gateway process. It supports provider/model discovery, session admission, bounded streaming turns, cancellation, and close/recovery status. The gateway returns `accountRef`, `authMode`, `planType`, `expiresAt`, and provider/model identity, but never raw credentials. It rejects requests whose operator/account binding, model policy, data policy, or capability set is absent or mismatched.

`ProviderRegistry` exposes explicit registration and lookup by canonical provider ID. It rejects duplicate IDs, unknown providers, malformed model references, and adapters whose declared capabilities do not cover a requested operation. Provider loading is allowlisted and configuration-driven; arbitrary model-provided module loading is forbidden.

Each provider adapter declares its authentication modes separately from its inference transport. `openai` API-key auth is not treated as equivalent to `openai-codex` ChatGPT subscription auth, and `anthropic` API-key auth is not treated as equivalent to `anthropic-oauth` subscription auth. This prevents a token from being sent to the wrong endpoint or wrong header protocol.

OAuth adapters own PKCE, loopback callback binding, state/nonce verification, callback timeout, refresh-token rotation, logout, revocation, account identification, minimum scopes, and token redaction. Anthropic subscription OAuth is not a production-supported third-party integration without written Anthropic approval; never transplant the Prime Agent private OAuth/header/identity flow or request its broad `org:create_api_key`, MCP, or file-upload scopes. OpenAI subscription access must use the documented Codex app-server managed-login boundary, not a direct ChatGPT token sent to the public Responses API or an undocumented ChatGPT backend.

The registry also owns model catalog metadata and capability negotiation. Model aliases are not trusted as identity; provider/model references are canonicalized before authorization. Provider-reported quota, usage-limit, and account-plan signals are normalized as bounded diagnostics, not converted into fabricated dollar costs.

## Provider-neutral invocation admission

The execution-kernel seam carries host-bound context and a decrementing grant. These values are created by an authenticated Control Plane service and cannot be supplied by model text:

```ts
interface InvocationContext {
  operatorId: string;
  projectId: string;
  goalId: string;
  missionBundleId: string;
  policyVersion: string;
  leaseRef?: string;
  fencingToken?: string;
}

interface CapabilityGrant {
  grantId: string;
  parentGrantId?: string;
  allowedTools: readonly string[];
  allowedSkills: readonly string[];
  modelPolicy: readonly string[];
  pathScope: readonly string[];
  outboundDataClasses: readonly string[];
  remaining: {
    modelTurns: number;
    toolCalls: number;
    childCalls: number;
    outputTokens: number;
    wallTimeMs: number;
    retryCount: number;
  };
}

interface SpawnRequest {
  name: string;
  context: InvocationContext;
  grant: CapabilityGrant;
  modelPolicy: readonly string[];
  idempotencyKey: string;
  parent?: ExecutionRef;
  prompt?: string;
}
```

Child admission atomically decrements the parent's `childCalls` and creates a persisted child grant. Each child grant must be a subset of every parent/Mission Bundle policy and may not increase a remaining counter. A missing context, grant, lease/fencing binding, model policy, or idempotency key fails closed.

## MaestroAgentRuntime

The runtime owns:

- root and child sessions with opaque Maestro references;
- the model turn/tool-call loop;
- tool allowlists from the controller profile or Mission Bundle;
- skill/instruction context as host-owned prompt input;
- child capability narrowing and depth/worker ceilings;
- cancellation and provider cancellation requests;
- normalized observations, activity, usage, answers, errors, and model identity;
- terminal release only after durable outcome recording;
- bounded retries and truthful `unknown` state after an ambiguous provider timeout;
- explicit `resume`/`reconnect` behavior based on durable binding evidence.

A child is a new Maestro invocation using the selected provider. It is not a provider-native RLM object. A child cannot widen project, Goal, tool, path, budget, or approval authority.

## Natural-language control

Natural-language control is a backend conversation endpoint, not direct model authority:

```text
user text
  -> MaestroAgentRuntime
  -> model provider
  -> normalized ToolCall
  -> host-side schema/policy validation
  -> existing authenticated API client / Control Plane service
  -> durable result/event
  -> model response
```

Reads and ordinary mutations use the same typed API path as the CLI/TUI. Critical operations return an approval-required result and use the existing durable approval and local-confirmation policy. The model cannot approve its own request.

## Model identity boundary

Provider-qualified model identity is a deliberate domain/evidence value, not a credential or provider SDK object. `ModelIdentity.provider` and `ModelIdentity.id` are canonical strings validated before admission and durably recorded for audit. Provider-native request/session IDs remain gateway-local and do not cross into authority-bearing domain references.

## Model authorization

`Mission Bundle.approvedModels` is converted to canonical provider-qualified references such as `openai/gpt-...` or `anthropic/claude-...`. The runtime resolves exactly one model before external admission and rejects missing, ambiguous, or unapproved models.

The actual `ModelIdentity` is recorded with the invocation evidence. A model/provider switch applies only to new sessions/turns and cannot rewrite an in-flight binding. Legacy unqualified test fixtures are made explicit before the production path is enabled.

## Configuration and selection

The Control Plane resolves a registered provider/model profile through the model-gateway. Provider SDKs, API keys, and subscription refresh tokens stay in that gateway process. The Control Plane configuration contains no provider-specific SDK object or raw credential:

```text
MAESTRO_MODEL_GATEWAY_URL=<authenticated local RPC endpoint>
MAESTRO_MODEL_PROVIDER=<registered provider id>
MAESTRO_MODEL_ID=<provider model id>
MAESTRO_MODEL_AUTH=<api-key | oauth | provider-default>
```

API keys use provider-specific environment variables or an OS-backed gateway secret store. Subscription login uses the gateway's provider-owned auth plugin. OAuth access/refresh tokens are never sent to the TUI conversation, model, Control Plane database, event stream, or ordinary Control Plane logs.

The credential belongs to an explicit Maestro operator/provider account binding. A single process-wide subscription token must not silently authorize multiple operators. A remote Control Plane requires authenticated gateway pairing; raw token forwarding through TUI or Control Plane requests is forbidden.
OAuth login state is single-use, expires quickly, and is bound to authenticated operator, provider ID, initiating TUI session, expected loopback host/port, PKCE verifier, and nonce. Callback replay, wrong provider, cross-operator callback, wrong host/port, refresh-token reuse, and account-identity mismatch are rejected. OAuth state is not process-global.

TUI session persistence is versioned and strict. It may contain workspace/project/Goal, conversation ID/version/cursor, provider-qualified model, auth mode, and opaque account reference only. It never contains access/refresh tokens, API keys, prompts, raw tool results, callback codes, or provider request IDs. Changing model creates a new conversation (or an explicitly authorized new turn); it cannot mutate an existing in-flight binding.
OAuth login state is single-use, expires quickly, and is bound to authenticated operator, provider ID, initiating TUI session, expected loopback host/port, PKCE verifier, and nonce. Callback replay, wrong provider, cross-operator callback, wrong host/port, refresh-token reuse, and account-identity mismatch are rejected. OAuth state is not process-global.

TUI session persistence is versioned and strict. It may contain workspace/project/Goal, conversation ID/version/cursor, provider-qualified model, auth mode, and opaque account reference only. It never contains access/refresh tokens, API keys, prompts, raw tool results, callback codes, or provider request IDs. Changing model creates a new conversation or requires an explicit new-turn policy; it cannot mutate an existing in-flight binding.

The TUI may display and request a model change, but the selected model and credential binding must be resolved and authorized by the backend. No local TUI setting can authorize an unapproved Worker model. There is no Prime Agent toggle after removal.

## Tool and authority boundary

`ToolRegistry` contains only explicitly registered Maestro tools. Each tool has:

- stable name and version;
- strict input/output schema;
- read or mutation classification;
- allowed capability and target scope;
- Control Plane/API implementation;
- approval requirement where applicable.

The runtime validates every model tool call before execution. Unknown tools, malformed arguments, cross-project/Goal targets, expired grants, stale leases, forbidden effects, and missing approvals fail closed. Tool results are observations, not new grants.

## Error and recovery behavior

- Missing API key: provider setup-required error; no fallback.
- Provider authentication failure: stable provider-auth error; bounded retry only for retryable transport failures.
- Unsupported provider capability: explicit unavailable result; no guessed emulation.
- Timeout after request admission: preserve `unknown` until reconciliation proves outcome.
- Cancellation phases are `queued`, `provider_turn`, `tool_executing`, and `terminal`. A confirmed provider cancellation may become `cancelled` only before an external effect begins. A `requested`, `unsupported`, or `unknown` provider cancellation, or an effect already started, remains `unknown` until reconciliation.
- Provider switch during active work: rejected or deferred; active invocation retains immutable binding.
- Process restart: follow existing worker fencing/reconciliation rules. `resume`/`reconnect` return a typed `RecoveryResult`: `reconnected` only with durable gateway binding proof, `terminal` with durable terminal evidence, or `unknown` with fencing/reconciliation required. The runtime never throws `Promise<never>` for a supported recovery path and never turns an unproven provider call into success.
- Runtime close: stop new admissions, cancel active provider requests within the configured drain bound, and release only after durable terminal recording.

## Removal and migration

- Remove `@maestro/prime-adapter` from the workspace references and `prime-agent` from dependencies/lockfile.
- Add a provider-neutral core package plus separately registered provider adapter modules; the core package must not import concrete provider SDKs.
- Remove `primeAgentVersion` from Control Plane configuration and tests.
- Replace production default composition in `apps/control-plane/src/main.ts` with `MaestroAgentRuntime`.
- Preserve test-only `ExecutionKernelPort` injection.
- Migrate Prime-specific live tests to provider/runtime contract tests; tests requiring real external credentials remain explicitly environment-gated.
- Add additive durable tables/migration for controller profiles, conversations, turns, invocations, tool calls, stream cursors, provider bindings, idempotency claims, quotas, and actual model identity.
- Keep opaque domain references stable; provider request/session IDs remain gateway-local and are never used as Maestro authority IDs.
- Do not retain an unused Prime toggle or silently substitute a different engine.

## Design risks and explicit gates

The following are implementation gates, not assumptions:

1. **Subscription protocol stability:** OAuth login and subscription inference transports must be verified against provider-supported documentation or an explicitly accepted experimental boundary. Private/undocumented endpoints cannot be presented as a stable production guarantee. OpenAI ChatGPT subscription uses the documented Codex app-server managed-login boundary; it is not sent to the public Responses API.
2. **Credential locality:** the separate model-gateway process owns OAuth refresh tokens. Remote Control Plane operation requires authenticated gateway pairing; raw token forwarding is forbidden. Package boundaries are insufficient.
3. **Account attribution:** every invocation must bind to a Maestro operator and provider account reference without storing the secret. Cross-operator credential reuse is rejected.
4. **Anthropic subscription policy:** Claude Pro/Max OAuth is not enabled without written Anthropic approval. Do not copy Prime Agent's private Claude Code headers, identity prompt, or broad scopes.
4. **Provider capability drift:** tool calling, streaming, cancellation, context limits, usage, and model availability are provider capabilities. Unsupported behavior is unavailable, not guessed.
6. **Prompt/tool injection:** model text and tool results are untrusted. Only host-side schema/policy checks can authorize a call; prompt instructions cannot widen grants.
7. **Budget and quota truth:** subscription plans may enforce rate/usage limits or extra billing. The runtime reports provider usage/limit diagnostics and stops on provider refusal; it does not infer remaining plan quota.
8. **History privacy:** conversation and tool-result persistence needs an explicit retention/redaction policy. Provider credentials, auth callbacks, and sensitive tool output must not appear in logs or durable events.
9. **Provider plugin supply chain:** future adapters are statically allowlisted and version-pinned. Model output cannot install or load a provider.
10. **Recovery boundary:** provider request IDs and session IDs remain adapter-local. Maestro may claim resume/reconnect only after a durable binding contract exists; otherwise it records `unknown` and fences retry.
10. **Controller policy:** every root conversation resolves a named controller profile and allowlist; `MAESTRO_MODEL_ID` is only a default, never authorization.
11. **Runtime placement:** model tools execute through the authenticated Control Plane service boundary, never a second unauthenticated HTTP path or direct persistence import.
12. **Effect uncertainty:** cancellation has explicit phases (`queued`, `provider_turn`, `tool_executing`, `terminal`); a completed/ambiguous external effect is `unknown`, not `cancelled`.
13. **Abuse control:** per-operator/project/conversation quotas and one active turn per conversation are enforced durably; retries cannot evade limits.
A quota reservation has an idempotency key, durable counter/lease, stable `conversation_rate_limited` error, and `Retry-After` where retry is safe. Concurrent admission, process restart, and duplicate retries are covered by integration tests.
14. **Outbound boundary:** provider-specific retention, training, and data-region capabilities are checked against typed Goal data policy before sensitive context leaves the process.
15. **Reference opacity:** provider request/session IDs never become model-visible or authority-bearing IDs; Maestro exposes only its own opaque invocation references.
16. **Error taxonomy:** provider auth, model selection, quota, capability, and recovery failures use distinct stable API errors and are not collapsed into database-unavailable.

## Acceptance criteria

- `npm run build` and `npm run check` pass after Prime removal.
- No production import, package dependency, lockfile entry, or config field requires `prime-agent`.
- Provider SDKs and subscription credentials exist only in the separately authenticated model-gateway process; Control Plane cannot access raw credentials.
- Every registered provider adapter, including API-key and subscription variants, passes the same provider contract tests for text, normalized tool calls, bounded streaming events, usage, cancellation outcome, provider errors, capability negotiation, and model identity.
- Conversation create/turn/stream/cancel/reconnect routes enforce authentication, route-bound project/Goal context, idempotency, serialized versions, durable cursors, quotas, and typed provider/auth/model/recovery errors.
- Root and child `ToolContext` delegation cannot override actor/project/Goal, grant, model policy, outbound data policy, or approval identity.
- Adding a provider requires only its adapter, credential resolver, registration, and contract tests; no `MaestroAgentRuntime` or Control Plane business-service change.
- Native runtime passes the `ExecutionKernelPort` contract for root/child execution, observation, Tool dispatch, cancellation, release, and unknown state.
- Natural-language reads, ordinary mutations, and critical-action requests all reach the existing Control Plane path.
- `approvedModels` is enforced before provider admission and actual provider/model identity is durably observable.
- Project/Goal binding, leases, fencing, idempotency, durable approval, and external-effect authorization are unchanged.
- Provider credentials are never persisted in durable Maestro state or exposed to the model.
- A malformed or compromised provider adapter/gateway response cannot invoke tools, read persistence, widen grants, or override actor/project/Goal context.
- PostgreSQL and real-process recovery evidence is required before operational acceptance; unavailable infrastructure remains explicitly reported.

## Non-goals

- No provider-specific OAuth or subscription behavior in the core runtime.
- No Anthropic subscription OAuth without written Anthropic approval; until then the provider is explicitly unavailable, not silently API-key substituted.
- No undocumented subscription transport may be claimed as a stable production provider; OpenAI subscription mode must be isolated behind the documented Codex app-server boundary.
- No provider fallback or automatic model routing.
- No direct model access to persistence, arbitrary shell, filesystem, MCP, or child-agent APIs.
- No weakening of existing approval, lease, fencing, or recovery boundaries.
- No automatic local PostgreSQL/operator bootstrap.
