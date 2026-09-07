# Maestro Agent Runtime and Model Provider Design

**Date:** 2026-09-07  
**Status:** Superseded by `2026-09-07-maestro-native-agent-backend-design.md`  
**Scope:** Natural-language control, swappable model providers, and Prime Agent runtime toggle

## Goal

Allow Maestro to keep its natural-language control surface while replacing both the model provider and the agent runtime without changing Control Plane authority, durable approval, worker fencing, lease, idempotency, or evidence rules.

A user must be able to choose OpenAI/ChatGPT or Anthropic/Claude models and still use the same natural-language operations, tools, child agents, cancellation, live observation, usage reporting, and approval flow. Prime Agent must be optional rather than the architectural source of those capabilities.

## Terminology

- **Model provider:** a model-facing adapter that sends a normalized conversation/tool request to a provider API and returns normalized text, tool calls, usage, cancellation, and model identity. Examples: OpenAI Responses, Anthropic Messages, Prime Inference.
- **Agent runtime:** the orchestration layer that owns sessions, tool dispatch, child invocations, cancellation, observation, and lifecycle. Examples: the existing Prime Agent runtime and the new Maestro-owned runtime.
- **Natural-language control:** an authenticated Maestro conversation in which a model interprets user text, uses only the tools exposed by Maestro, and reaches the existing typed API/Control Plane path. It is not direct model authority.
- **Typed API:** the existing explicit API-client and Control Plane command path used after a tool call or command is validated.

## Product behavior

### Runtime and model selection

The user-facing selection has one model axis and one Prime Agent compatibility toggle:

```text
model:        provider/model-id
prime-agent:  on | off
```

The TUI exposes equivalent commands such as:

```text
/model use openai/gpt-...
/model use anthropic/claude-...
/prime-agent on
/prime-agent off
```

The runtime choice is an internal implementation detail. `prime-agent on` uses the Prime Agent adapter. `prime-agent off` uses the Maestro-owned common runtime with the selected direct model provider. The toggle never disables natural-language control.

If the selected model provider or the requested Prime Agent mode is unavailable, Maestro reports a truthful unavailable/setup-required state. It never silently falls back to another provider or runtime.

### Natural-language flow

```text
CEO text
  -> selected AgentRuntime
  -> normalized ModelProvider
  -> model text or typed ToolCall
  -> Maestro tool/policy validator
  -> authenticated Maestro API client
  -> Control Plane authorization/approval/lease/fencing/idempotency
  -> durable state and events
  -> normalized result back to the conversation
```

The model cannot call PostgreSQL, persistence modules, arbitrary shell, filesystem, MCP, or child-agent APIs directly. The runtime only exposes registered Maestro tools. Tool implementations remain host-side and use the existing authenticated API client or existing provider-neutral adapters.

A critical tool call does not become authorized because the model requested it. The existing durable approval endpoint and local confirmation rules remain the only approval path.

## Architecture

```text
Maestro TUI / CLI conversation
        |
        v
NaturalLanguageController
        |
        +--> AgentRuntimePort
                |
                +--> PrimeAgentRuntimeAdapter
                |       +--> Prime Agent SDK
                |       +--> selected Prime-supported model
                |
                +--> MaestroAgentRuntime
                        +--> ModelProviderPort
                        |       +--> OpenAI Responses adapter
                        |       +--> Anthropic Messages adapter
                        |       +--> Prime Inference adapter
                        |
                        +--> ToolRegistry / ToolExecutor
                        +--> ChildInvocationManager
                        +--> Observation and cancellation state
                        +--> Control Plane API client
```

The existing `ExecutionKernelPort` remains the Control Plane's provider-neutral worker boundary. The Prime Agent adapter and the Maestro-owned runtime both implement it. `MaestroAgentRuntime` owns the common loop and delegates only model I/O to `ModelProviderPort`; Prime Agent remains an optional compatibility implementation selected only by the internal `prime-agent` toggle.

### ModelProviderPort

The exact TypeScript names may follow repository conventions, but the contract must normalize these values:

```ts
interface ModelProviderPort {
  readonly identity: ModelIdentity;
  turn(request: ModelTurnRequest): Promise<ModelTurnResult>;
  cancel(requestId: string): Promise<void>;
  close(): Promise<void>;
}
```

`ModelTurnRequest` contains conversation messages, normalized tool definitions, requested output/turn limits, and an opaque request ID. `ModelTurnResult` contains text, zero or more normalized tool calls, terminal/continuation reason, usage when supplied, and the provider/model identity. Provider adapters translate OpenAI Responses, Anthropic Messages, and Prime Agent-compatible model responses into this shape.

Provider authentication is local to the adapter. ChatGPT/Claude subscription OAuth tokens and API keys never enter Control Plane durable state, TUI session files, Mission Bundles, or model prompts.

### MaestroAgentRuntime

The Maestro-owned runtime provides:

- Root and child sessions with explicit parent/child references.
- Normalized model turns and tool-call loops.
- Tool allowlists derived from the Mission Bundle or controller profile.
- Skill/instruction loading as host-owned prompt context, not provider-specific behavior.
- Capability narrowing for children; a child cannot widen its parent's grant.
- Cancellation that records the request before attempting provider cancellation.
- Normalized status, tool activity, usage, answer, error, and model identity.
- Explicit terminal release after the caller durably records the outcome.
- Bounded retry behavior and `unknown` status when provider state cannot be proven.
- No direct mutation of persistence; all durable state and authorization remain in Control Plane services.

A direct OpenAI/Claude model therefore gets the same effective capabilities through Maestro's runtime rather than needing Prime Agent's RLM implementation.

### PrimeAgentRuntimeAdapter

The current Prime adapter remains available behind the runtime selector. It may continue to use Prime Agent's session, RLM child, tool restriction, message, abort, and snapshot APIs. It must additionally accept the explicit selected model and expose the same model-policy and capability checks as `MaestroAgentRuntime`.

Prime Agent-specific behavior is an adapter detail. RLM child IDs, Prime session IDs, and provider credentials must not cross the domain boundary; only opaque Maestro references and normalized observations may cross it.

## Model authorization

`Mission Bundle.approvedModels` becomes an explicit model-reference allowlist. A model reference uses a canonical provider-qualified form such as `openai/gpt-...` or `anthropic/claude-...`. The selected runtime must resolve exactly one `ModelIdentity` before external admission.

Admission rules:

1. A missing or ambiguous model selection is rejected before provider admission.
2. The canonical selected model must match the Mission Bundle allowlist.
3. Runtime/provider identity must not be inferred from a model display name.
4. `getModelIdentity` must return the model that actually executed the invocation.
5. Changing the model or runtime creates a new session/invocation configuration; it cannot rewrite an in-flight binding.
6. Legacy unqualified fixture values are migrated or made explicit before the new execution path is enabled; no permissive production fallback is allowed.

This closes the current gap where `approvedModels` is validated but not forwarded into worker admission and the Prime adapter lets Prime Agent choose its configured/default model.

## Child agents and tools

Child agents are runtime-created sessions, not provider-native RLM objects. A child receives:

- a new opaque Maestro invocation reference;
- the parent Goal, project, and session binding;
- a narrowed tool/capability grant;
- an explicit model reference selected from the same approved policy;
- a bounded prompt and depth/worker ceiling.

A provider tool call is data until the host validates it. The host rejects unknown tools, malformed arguments, out-of-scope targets, expired grants, stale leases, and missing durable approvals. Tool results are returned to the model as untrusted observations; they never grant new authority.

## Error and recovery behavior

- Provider authentication failure: setup-required/provider-auth error; do not retry indefinitely.
- Unsupported provider capability: explicit unavailable result; do not emulate by guessing.
- Tool-call validation failure: return a structured correction/error to the model and record the rejected attempt where the existing event surface supports it.
- Provider timeout after admission: preserve `unknown` until reconciliation proves the outcome.
- Process restart: use the existing worker fencing/reconciliation policy. The Maestro runtime must not claim resume/reconnect until it has a durable provider/session binding; otherwise it reports unavailable/unknown.
- Provider switch: applies to new turns/sessions only. In-flight work retains its immutable model/runtime binding.

## Rollout boundaries

1. Introduce normalized model/provider contracts and explicit model configuration.
2. Enforce `approvedModels` before any provider admission and record model identity.
3. Implement the Maestro-owned runtime with one provider adapter first, using the common tool/child/cancellation contract.
4. Add the second provider adapter and provider-specific normalization tests.
5. Add the `prime-agent on/off` toggle and TUI status/diagnostics; keep the runtime choice internal.
6. Keep Prime Agent as an optional compatibility implementation until independent parity and real-process tests pass.
7. Do not claim full replacement support while PostgreSQL, real-process recovery, or provider acceptance gates are unavailable.

## Acceptance criteria

- Natural-language control remains available under both runtime selections.
- OpenAI and Anthropic adapters can execute at least one representative read, one non-critical mutation request, one critical-action request requiring durable approval, one tool call, and one child invocation through the same Control Plane path.
- The same Tool/Worker allowlist, project/Goal binding, lease, fencing, idempotency, and approval checks apply regardless of runtime/provider.
- A model outside `approvedModels` is rejected before external admission.
- TUI and durable evidence show the actual provider, model ID, runtime, invocation, usage, and terminal status.
- Cancellation, provider failure, unknown state, release, and restart behavior are covered by contract tests for every runtime.
- No provider credential is persisted in Control Plane state or exposed to the model as a tool result.
- Prime Agent can be toggled without disabling natural-language control; `off` selects the Maestro-owned runtime and never silently falls back.
- Existing CLI/`--json` behavior remains unchanged.

## Non-goals

- No direct provider authority to bypass Control Plane.
- No automatic provider fallback or model routing based on untrusted model output.
- No provider-specific semantics in `@maestro/domain`.
- No claim that a provider supports a capability until its adapter passes the common contract tests.
- No automatic PostgreSQL/operator bootstrap as part of this work.
