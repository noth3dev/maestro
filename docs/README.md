<p align="center">
  <a href="README.md">
    <img alt="Maestro" src="assets/logo.svg" width="360" style="max-width: 100%;">
  </a>
</p>

# Maestro Documentation

Maestro is a **durable, hierarchical AI orchestration system** built on top of the **Prime Agent SDK**.  
This documentation set provides a detailed breakdown of Maestro's system architecture, multi-agent organizational structure, durable control plane, fail-closed authority model, phase roadmap, and developer guidelines.

---

## Documentation Index

### 1. [System Overview](file:///home/ubuntu/projects/ms/docs/01-system-overview.md)
* Architectural philosophy, design principles, separation of powers, and monorepo structure.
* Prime Agent SDK boundary vs Maestro control-plane responsibilities.

### 2. [Hierarchical Orchestration](file:///home/ubuntu/projects/ms/docs/02-hierarchical-orchestration.md)
* End-to-end execution lifecycle: CEO ➔ Sane ➔ Overture Crew ➔ Department Heads ➔ Head Council ➔ Workers ➔ Overwatch / Certification.
* Permanent Groups & Departments structure, personas, and wake-on-demand mechanics.

### 3. [Durable Control Plane & Durability](file:///home/ubuntu/projects/ms/docs/03-durable-control-plane.md)
* Single operational source of truth with PostgreSQL 17, Drizzle ORM, append-only domain event log (`goal_events`), and transactional outbox.
* Monotonic Fencing Token Leases (`goal_leases`), signed `bigint` precision, idempotent command processing, and crash recovery reconciliation.

### 4. [Security & Authority Model](file:///home/ubuntu/projects/ms/docs/04-security-and-authority-model.md)
* Fail-Closed & Default-Deny security principle enforced by `AuthorizedEffectExecutor`.
* Action classification matrix (`ordinary`, `critical`, `forbidden`, `ambiguous`) and single launch confirmation.
* Sealed Submission protocol with SHA-256 canonical JSON snapshots for cryptographically immutable audit trails.

### 5. [Roadmap & Phase Status](file:///home/ubuntu/projects/ms/docs/05-roadmap-and-phase-status.md)
* Phase 1 through Phase 8 milestones, verified code status vs. operational usability exit gates.
* Post-Phase 8 Extension: **Luthiery** (Dynamic MCP Server Workshop & Tool Generation).

### 6. [Developer & Operations Guide](file:///home/ubuntu/projects/ms/docs/06-developer-and-operations-guide.md)
* Monorepo package directory layout, Node.js 24 & TypeScript environment setup.
* Build (`npm run build`), test (`npm test`), and full verification (`npm run check`) workflows.
* Real PostgreSQL integration testing, live Prime Agent integration, CLI commands, and operating protocols.
