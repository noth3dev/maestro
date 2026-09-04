# Contributing to Maestro

Thank you for your interest in contributing to **Maestro**! Maestro is an open-source enterprise AI orchestration framework built on top of the **Prime Agent SDK**, designed for reliable, long-running, multi-agent goal execution.

We welcome contributions of all forms—bug reports, feature proposals, documentation improvements, and pull requests.

---

## 1. Core Architectural Guarantees

Before submitting code, please ensure your changes adhere to Maestro's foundational architectural guarantees:

1. **Durable Control Plane First**: PostgreSQL 17 is the single source of truth for all domain aggregates, events, and transactional outboxes. In-memory states are non-canonical projections.
2. **Separation of Powers**: Executing agents (Workers/Heads) are strictly prohibited from certifying their own work. Verification is handled independently by Quality and Encore (Metronome & Encore Council).
3. **Fail-Closed & Default-Deny Security**: All tool calls and side effects must pass through `AuthorizedEffectExecutor`. Any unclassified, unauthorized, or out-of-scope effect is denied immediately.
4. **Idempotency & Monotonic Leases**: Every state mutation must be idempotent (`commandId` / `Idempotency-Key`) and fenced via monotonic bigint token leases (`goal_leases`).

---

## 2. Getting Started & Local Setup

### Prerequisites

- **Node.js**: `v24.x LTS` or higher
- **npm**: `v10.x` or higher
- **PostgreSQL**: `17.x` (required for persistence & integration tests)
- **Docker**: Required for running disposable test containers (`Testcontainers`)
- **OS**: Linux recommended

### Setup Commands

1. **Clone the repository**:
   ```bash
   git clone https://github.com/noth3dev/maestro.git
   cd ms
   ```

2. **Install workspace dependencies**:
   ```bash
   npm install
   ```

### Parallel worktrees

Create each parallel task in its own branch and worktree. The helper links the
worktree to the repository's already-installed dependencies, so `npm install`
is not repeated per worktree:

```bash
npm run worktree:add -- hardening/my-task hardening/lifecycle
cd .worktrees/hardening-my-task
```

Commit and push from the worktree. Do not edit the same files from multiple
worktrees; merge or cherry-pick completed branches into the integration branch.

3. **Build all monorepo packages**:
   ```bash
   npm run build
   ```

4. **Run unit tests across all workspaces**:
   ```bash
   npm test
   ```

5. **Run full build, typecheck, and test verification**:
   ```bash
   npm run check
   ```

---

## 3. Pull Request Guidelines

1. **Branch Naming**: Use descriptive branch names like `feat/feature-name`, `fix/bug-fix`, or `docs/doc-update`.
2. **Commit Messages**: Use Conventional Commits formatting (e.g., `feat: ...`, `fix: ...`, `docs: ...`, `refactor: ...`).
3. **Verification**: Always run `npm run check` locally to ensure all TypeScript builds pass and all unit/integration tests succeed before creating a PR.
4. **Documentation**: If your change modifies system behavior, CLI commands, or domain models, please update the corresponding files in `docs/en/` and `docs/ko/`.

---

## 4. Security Disclosures

If you discover a security vulnerability or authority leakage issue, please do **NOT** open a public issue. Review our [Security Policy](SECURITY.md) for confidential disclosure instructions.

---

## 5. License

By contributing to Maestro, you agree that your contributions will be licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. See the [LICENSE](LICENSE) file for details.
