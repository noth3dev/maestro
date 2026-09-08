# 06. Developer & Operations Guide

This guide covers developer onboarding, repository structure, local environment configuration, testing procedures, CLI command usage, and operational protocol guidelines.

---

## 1. Monorepo Package Layout

Maestro uses **npm workspaces** to manage packages and applications:

```text
├── apps/
│   ├── control-plane/     # Fastify 5 REST & SSE authoritative service
│   ├── model-gateway/     # Credential-owning provider process
│   ├── cli/               # Authenticated command client and TUI
│   ├── secretary/         # Electron + React desktop client
│   ├── discord/           # Out-of-band Discord incident daemon
│   └── device-agent/      # Enrolled-device protocol process
├── packages/
│   ├── contracts/         # Zod schemas, API contracts & event definitions
│   ├── domain/            # Core business models and runtime boundary types
│   ├── persistence/       # PostgreSQL 17 / pg queries, services & migrations
│   ├── authority/         # Action classification & AuthorizedEffectExecutor
│   ├── evidence/          # SHA-256 evidence bundle generation & verification
│   ├── agent-runtime/     # Maestro-owned provider-neutral runtime and tool loop
│   ├── model-provider-openai/     # OpenAI and Codex app-server adapters
│   ├── model-provider-anthropic/ # Anthropic API-key adapter
│   ├── environment-adapter/      # Environment and browser boundaries
│   ├── device-agent/      # Device protocol support and grant validation
│   ├── git-adapter/       # Git worktree, branch & commit executor
│   └── api-client/        # Type-safe HTTP and SSE client library
```

---

## 2. Environment Requirements

* **Node.js**: `v24.x LTS`
* **npm**: `v10.x` or higher
* **PostgreSQL**: `17.x` (required for persistence integration tests)
* **Docker**: Optional helper for starting a disposable PostgreSQL instance; tests consume `MAESTRO_TEST_DATABASE_URL` directly (the repository does not use Testcontainers).
* **OS**: Linux recommended for Docker/PostgreSQL and process-based integration tests; the native runtime uses the authenticated Model Gateway for provider isolation.

---

## 3. Build & Test Commands

### 1) TypeScript Project Build
Build all monorepo workspaces using TypeScript project references (`tsc -b`):
```bash
npm run build
```

### 2) Pure Unit Testing (Vitest)
Run non-database unit tests across all packages:
```bash
npm test
```

### 3) Full System Check (`npm run check`)
Runs the TypeScript build and all Vitest suites in sequence. Linting is a separate command:
```bash
npm run check
npm run lint
```

### 4) PostgreSQL Integration Testing
To run real database integration suites, pass a disposable PostgreSQL URL via `MAESTRO_TEST_DATABASE_URL`:
```bash
MAESTRO_TEST_DATABASE_URL=postgresql://maestro_test:maestro_test@127.0.0.1:55432/maestro_test npm test
```

### 5) CI-equivalent PostgreSQL run
GitHub Actions runs the static checks and a clean PostgreSQL 17 service job. To reproduce the database job locally without parallel schema races:
```bash
MAESTRO_TEST_DATABASE_URL=postgresql://maestro_test:maestro_test@127.0.0.1:55432/maestro_test npm test -- --pool forks --maxWorkers 1
```

### 6) Current TUI and runtime boundary
The CLI TUI uses `@earendil-works/pi-tui` `0.85.1` for terminal rendering, input, overlays, and scrolling. It has no execution authority and never writes PostgreSQL or provider credentials. All execution requests go through the authenticated Control Plane and native runtime.

---

## 4. Runtime, tool, and permission boundaries

The following boundaries are current production behavior, not design intent:

| Surface | Current authority | Current limitation |
| :--- | :--- | :--- |
| `apps/control-plane` | Authenticated routes, PostgreSQL leases/fencing, project roles, capability grants, and idempotency | It fails closed when the Model Gateway or a required concrete adapter is missing. |
| `apps/model-gateway` | Provider credentials, provider/account admission, model identity, cancellation, and managed login | Credentials never cross into Control Plane persistence or prompts. |
| Native `ToolRegistry` | Validates registered tool names, argument schemas, output schemas, grants, and data class | Production composition currently registers **zero** host tools. Unregistered tools are rejected. |
| OpenAI Codex app-server adapter | Text turns through the public app-server protocol | Tool-bearing turns are rejected; sessions use read-only sandbox and no approvals. |
| Git adapter | Local branch/worktree/commit operations through `AuthorizedEffectExecutor` | Remote push and other critical effects require explicit approval and a concrete effect adapter. |
| Critical-action route | Records exact approval and invokes an injected effect seam | Production has no default no-op effect: an absent adapter throws instead of claiming success. |
| CLI/TUI and Secretary | Authenticated API client only | Neither client connects directly to PostgreSQL, providers, gateway credentials, or device transports. |

Do not document a tool, permission, filesystem scope, or network scope until it has a named contract, an authority classification, a concrete adapter, and acceptance coverage through the real gateway/process boundary. The current native Worker is therefore a bounded text-generation path, not a general shell or file-editing agent.



### Ensemble Router implementation boundary

The domain and wire artifact contracts are present for A/D/E, B provider facts, C operational overlay plus pure Goal snapshot, and four pressure bands. Migration [`0072_ensemble_router_artifacts.sql`](../packages/persistence/migrations/0072_ensemble_router_artifacts.sql) and [`ensemble-router-artifacts.ts`](../packages/persistence/src/ensemble-router-artifacts.ts) now provide durable overlay/Goal snapshot and append-only routing-evidence storage. The domain `model_map` validator and empty human-owned `config/model_map.json` baseline are also present. Router selection, fixed-model pin migration, host-tool writes/effects, and live acceptance remain open. Do not describe `MAESTRO_NATIVE_MODEL` or the singleton `modelPolicy` as automatic routing; they are explicit fixed-model/admission boundaries until migration is complete.
## 5. Command-Line Interface (CLI) Usage

The Maestro CLI (`apps/cli`) is an authenticated command client for the control plane HTTP REST API. It exposes the currently implemented lifecycle, review, Git, budget, and reporting commands; the TUI and Secretary remain client layers rather than independent runtimes.

```bash
# Get details for a specific Goal
node apps/cli/dist/main.js goal get --project-id <projectId> --goal-id <goalId>

# List append-only domain events for a Goal
node apps/cli/dist/main.js events list --project-id <projectId>

# List Metronome challenges, Encore rounds, and certifications for a Goal
node apps/cli/dist/main.js metronome-challenges list --project-id <projectId> --goal-id <goalId>
node apps/cli/dist/main.js encore-council list --project-id <projectId> --goal-id <goalId>
node apps/cli/dist/main.js certifications list --project-id <projectId> --goal-id <goalId>

# Retrieve the Concertmaster report for a Goal
node apps/cli/dist/main.js concertmaster-report get --project-id <projectId> --goal-id <goalId>
```

---


### Native model conversations

Run the model gateway as a separate process. Provider SDKs and API keys belong only in that process:

```bash
MAESTRO_MODEL_GATEWAY_TOKEN=<random-secret> \
OPENAI_API_KEY=<key> \
npm --workspace @maestro/model-gateway start
```

Configure the Control Plane with the same gateway token. Set `MAESTRO_NATIVE_MODEL` only as an explicit fixed-model pin/routing-off setting when host-created Head/Encore sessions cannot derive a Mission Bundle model; there is no implicit default. Conversation turns select an exact model through the CLI/API:

```bash
export MAESTRO_MODEL_GATEWAY_TOKEN=<random-secret>
export MAESTRO_NATIVE_MODEL=openai/gpt-5
# Optional CLI/TUI default; the TUI also accepts an exact --model value per conversation.
export MAESTRO_MODEL=openai/gpt-5
maestro models list
maestro conversation create --project-id <project-uuid> --goal-id <goal-uuid> --model openai/gpt-5
maestro conversation turn --conversation-id <conversation-uuid> --project-id <project-uuid> --text "status?"
```

The TUI uses the selected project and Goal and sends free text to the same authenticated conversation API. It does not persist bearer tokens, provider keys, or gateway credentials in its workspace session.

### ChatGPT account login (OAuth handled by the public Codex app-server)

Maestro does not copy private ChatGPT or Anthropic OAuth endpoints. ChatGPT Plus/Pro account login is delegated to the public OpenAI Codex app-server protocol. The app-server owns its browser OAuth callback and refresh tokens; Maestro receives only a login URL and status metadata.

Configure the gateway with a separately installed and trusted `codex` executable:

```bash
MAESTRO_MODEL_GATEWAY_TOKEN=<random-secret> \
MAESTRO_CODEX_APP_SERVER_COMMAND=codex \
MAESTRO_CODEX_MODELS=gpt-5.3-codex \
npm --workspace @maestro/model-gateway start
```

Then sign in from the TUI with `/login`, choose `ChatGPT Plus / Pro`, and complete the browser flow. The non-interactive equivalent is:

```bash
maestro login openai-codex
maestro models list
```

Use an exact model identity such as `openai-codex/gpt-5.3-codex`. Anthropic Pro/Max subscription login is intentionally unavailable until Anthropic publishes or approves a supported integration. API-key login remains a separate legacy path for providers that support it.

## 6. Phase 4 process boundaries

### Device Agent

`apps/device-agent` is a separately running mTLS process. It requires `MAESTRO_DEVICE_AGENT_CONFIG` as JSON. Required keys are `databaseUrl`, `host`, `port`, `deviceId`, `identityFingerprint`, `issuerKeyId`, `issuerPublicKey`, `keyPath`, `certPath`, `caPath`, `statePath`, and `projectRoot`; `maxReadBytes` is optional. The database device must already be enrolled and its certificate fingerprint must match. The agent performs only the bounded project-file operation below `projectRoot`, after validating the signed Goal/grant/fencing envelope. It does not own Goal authority or provider credentials. See [`apps/device-agent/README.md`](../apps/device-agent/README.md) for the launch example.

### Discord Watchdog

`apps/discord` requires `DISCORD_BUFFER_PATH` and `DISCORD_CREDENTIAL`. `DISCORD_FLUSH_INTERVAL_MS` and `DISCORD_FRESHNESS_WINDOW_MS` have bounded defaults. `DISCORD_TARGET_API_URL` and `DISCORD_TARGET_API_TOKEN` are optional and enable delivery to the authenticated Control Plane. The credential signs watchdog envelopes and must not be written to evidence, logs, or PostgreSQL. See [`apps/discord/README.md`](../apps/discord/README.md).

## 7. Provisioning project access

Project membership and roles are granted through the authenticated admin endpoint. Set `MAESTRO_OPERATOR_PROVISIONING_ADMIN_ID` to the UUID of an active operator during deployment. If it is not set, the endpoint stays unavailable; no authenticated operator can grant access.

```bash
# The token is the existing credential envelope: <credential-id>.<secret>.
node apps/cli/dist/main.js admin project-access \
  --operator-id <target-operator-uuid> \
  --project-id <project-uuid> \
  --roles-json '["concertmaster","head-product"]' \
  --json
```

The endpoint is `POST /v1/admin/project-access` with the same JSON body. It requires a bearer token for the configured admin operator. The target operator must already exist and be active. Every requested role must be an exact standing role from `permanent_roles`; arbitrary capability strings, wildcard roles, inactive targets, duplicate roles, and partial grants are rejected. Membership and all roles commit in one transaction. Revocation remains one-way, so regranting creates new durable rows.

The admin route is intentionally not covered by the ordinary project-membership hook. Its explicit admin identity check is the authorization boundary, and the target project ID is never taken from the caller identity or inferred from another project.

---

## 8. Operating Protocol Summary

When working on the Maestro codebase, strictly adhere to the project operating protocol (`docs/OPERATING_PROTOCOL.md`):

1. **Single-Branch Hygiene**: `main` is the primary persistent branch. Worktrees (`.worktrees/`) and feature branches are strictly temporary and must be pruned immediately upon merging.
2. **Symlinked Node Modules**: Worktrees should symlink `node_modules` from root (`ln -s ../../node_modules .worktrees/<slug>/node_modules`) to conserve disk space and speed up setup.
3. **Disposable Container Cleanup**: Name disposable PostgreSQL containers distinctly (e.g., `maestro-<slug>-postgres`) and tear them down (`docker rm -f`) immediately after test verification.
4. **Independent Review Requirement**: Code written by an agent or subagent must be independently reviewed (no-edit review) before merging into `main`.
