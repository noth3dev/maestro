# 06. Developer & Operations Guide

This guide covers developer onboarding, repository structure, local environment configuration, testing procedures, CLI command usage, and operational protocol guidelines.

---

## 1. Monorepo Package Layout

Maestro uses **npm workspaces** to manage packages and applications:

```text
├── apps/
│   ├── control-plane/     # Fastify 5 REST & SSE Backend Server
│   ├── cli/               # Maestro Command Line Interface (CLI)
│   ├── secretary/         # Next.js Secretary Office Dashboard
│   └── discord/           # Out-of-band Discord Incident Daemon
├── packages/
│   ├── contracts/         # Zod schemas, API contracts & event definitions
│   ├── domain/            # Core business models (Goal, TaskContract, HeadCouncil)
│   ├── persistence/       # PostgreSQL 17 / Drizzle ORM layer & migrations
│   ├── authority/         # Security matrix & AuthorizedEffectExecutor
│   ├── evidence/          # SHA-256 evidence bundle generation & verification
│   ├── prime-adapter/     # Prime Agent SDK wrapper & domain ports
│   ├── git-adapter/       # Git worktree, branch & commit executor
│   └── api-client/        # Type-safe API client library
```

---

## 2. Environment Requirements

* **Node.js**: `v24.x LTS`
* **npm**: `v10.x` or higher
* **PostgreSQL**: `17.x` (required for persistence integration tests)
* **Docker**: Required for running disposable PostgreSQL test containers (`Testcontainers`)
* **OS**: Linux (recommended for Prime Agent security isolation primitives)

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
Runs TypeScript build, linting, and all unit test suites in sequence:
```bash
npm run check
```

### 4) PostgreSQL Integration Testing
To run real database integration suites, pass a disposable PostgreSQL URL via `MAESTRO_TEST_DATABASE_URL`:
```bash
MAESTRO_TEST_DATABASE_URL=postgresql://maestro_test:maestro_test@127.0.0.1:55432/maestro_test npm test
```

### 5) Live Prime Agent SDK Testing
Execute tests against the live Prime Agent SDK runtime:
```bash
MAESTRO_LIVE_PRIME=1 npm test -- packages/prime-adapter/src/sdk.live.test.ts
```

---

## 4. Command-Line Interface (CLI) Usage

The Maestro CLI (`apps/cli`) provides full operational parity with the control plane HTTP REST API.

```bash
# Get details for a specific Goal
node apps/cli/dist/main.js goal get <goalId>

# List append-only domain events for a Goal
node apps/cli/dist/main.js events list --goalId <goalId>

# Query a Metronome challenge
node apps/cli/dist/main.js metronome challenge <challengeId>

# Query an Encore Council deliberation round
node apps/cli/dist/main.js council round <roundId>

# Retrieve a Quality certification record
node apps/cli/dist/main.js certification get <certificationId>

# Retrieve the final certified Concertmaster report for a Goal
node apps/cli/dist/main.js report get <goalId>
```

---

## 5. Provisioning project access

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

## 6. Operating Protocol Summary

When working on the Maestro codebase, strictly adhere to the project operating protocol (`docs/OPERATING_PROTOCOL.md`):

1. **Single-Branch Hygiene**: `main` is the primary persistent branch. Worktrees (`.worktrees/`) and feature branches are strictly temporary and must be pruned immediately upon merging.
2. **Symlinked Node Modules**: Worktrees should symlink `node_modules` from root (`ln -s ../../node_modules .worktrees/<slug>/node_modules`) to conserve disk space and speed up setup.
3. **Disposable Container Cleanup**: Name disposable PostgreSQL containers distinctly (e.g., `maestro-<slug>-postgres`) and tear them down (`docker rm -f`) immediately after test verification.
4. **Independent Review Requirement**: Code written by an agent or subagent must be independently reviewed (no-edit review) before merging into `main`.
