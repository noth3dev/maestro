# Carnegie Embedded Database Ownership Attestation

## Status

Design proposal for review. Implementation remains gated on user approval of this document.

## Goal

Prevent Carnegie from reusing an unrelated PostgreSQL-compatible listener as its detached embedded database. The specific failure is a stale marker whose PID has been reused by a live process while another PostgreSQL server answers on the marker's host and port. A mistaken reuse could direct bootstrap migrations to the wrong database.

## Scope

This change covers:

- A live SQL-level cluster identity in newly written embedded-server markers.
- Verification of that identity before returning a shared detached-database handle.
- Safe compatibility behavior for existing markers.
- A clear, localized Carnegie Setup error and recovery hint for unverifiable listeners.
- Persistence and Setup regression coverage.

It does not add a database schema/table, OS-specific process APIs, automatic process termination, marker/data-directory deletion, provider calls, or a new Setup component or visual style.

## Evidence and documentation

Three independent reviewers confirmed that the non-Linux path currently proves only PID liveness, local marker-directory identity, and PostgreSQL reachability (`SELECT 1`); it does not prove that the responding server uses the marked cluster. Linux additionally checks process generation, command line, and live data-directory evidence.

The installed `@electric-sql/pglite` version is 0.5.8. A disposable runtime probe confirmed that `SELECT system_identifier::text FROM pg_control_system()` works through the app's local PostgreSQL wire protocol, returns different identifiers for two freshly initialized directories, and returns the same identifier after closing and reopening the same directory. The probe used only temporary `/dev/shm` directories and was cleaned up. `SHOW data_directory` returned the same virtual path (`/pglite/data`) for separate instances, so it cannot attest the host data directory.

Current PostgreSQL documentation describes control data as cluster-wide and exposes `pg_control_system().system_identifier` as a `bigint`. The replication protocol documentation calls the system identifier unique and uses it to verify that a standby belongs to the same cluster:

- https://www.postgresql.org/docs/current/functions-info.html#FUNCTIONS-PG-CONTROL
- https://www.postgresql.org/docs/current/protocol-replication.html#PROTOCOL-REPLICATION-IDENTIFY-SYSTEM

## Invariants

1. Every newly created detached-server marker records the live cluster `system_identifier` as decimal text. Text avoids loss of precision when handling PostgreSQL's `bigint` in JavaScript.
2. Reuse requires the live identifier returned by the marker's endpoint to match the marker exactly. A positive TCP connection or `SELECT 1` alone is never ownership proof.
3. The existing marker path/device/inode checks remain. Linux process-generation, command-line, environment, and post-probe checks remain as defense in depth.
4. A reachable endpoint with a missing, malformed, unsupported, or mismatched identity fails closed. It must never return a shared handle or proceed to application migrations.
5. A server that cannot be reached follows the existing bounded startup/retry behavior. An identity mismatch is reported as a conflicting/unverified listener, not treated as a stale marker to overwrite.
6. Older Linux markers without this field may be reused only when the existing live `/proc` process and data-directory checks prove ownership. Older macOS/Windows markers without this field fail closed because their recorded PID and local directory identity cannot prove which cluster answers the port.
7. The application does not kill a process or remove a marker/data directory during recovery. The marker stays mode `0600`; the cluster identifier is identity metadata, not a credential.
8. This protects against accidental wrong-listener reuse. It is not a boundary against a malicious same-user process that deliberately clones the embedded database files and marker.

## Ownership flow

### Writing a marker

After opening the embedded database and confirming that the data-directory identity is unchanged, the detached server reads the system identifier from its own PostgreSQL endpoint using a bounded, one-shot connection. It writes the identifier with the existing PID, URL, connection limit, directory identity, and optional Linux process identity before emitting `READY`. Failure to obtain a valid identifier prevents a new-format server from advertising readiness.

SQL identity lookup belongs in a small persistence helper with bounded connect/query deadlines and forced cleanup. Marker policy remains in `embedded-database.ts`; filesystem and Linux process identity remain in `embedded-database-identity.ts`. This keeps the SQL attestation separate from OS-specific identity code and avoids expanding a general bootstrap module.

### Reusing a marker

The existing marker host/port, PID, directory identity, and connection-option checks still run. The caller then obtains the live system identifier from the marker endpoint and compares it to the recorded decimal string before returning `{ shared: true }`. Preserve the existing Linux process identity and post-probe checks. A malformed or missing marker identifier is not silently treated as a match.

### Recovery in Carnegie

Use the existing Setup warning and recovery-hint layout. A stable diagnostic code, `MAESTRO_EMBEDDED_DATABASE_IDENTITY`, lets the renderer show concise English and Korean copy instead of raw backend text. The alert must explain that Carnegie could not verify the local database and did not connect to it or run migrations. The recovery hint should ask the user to close the older Maestro embedded-database process and retry, warn not to delete database or marker files, and keep the existing Manual connection option available. Do not add a new panel, motion, or styling system.

Design read: safety-first local setup recovery; calm, direct copy; reuse the existing alert and hint hierarchy; no additional visual density or motion.

## Verification and acceptance

Persistence tests must establish:

- New markers contain a valid decimal `system_identifier`.
- Same-cluster detached reuse still succeeds, including after a server restart where supported.
- A live, reachable listener with a different cluster identifier is rejected and is never returned as shared.
- Missing identity is rejected on non-Linux; the Linux legacy path remains available only when its existing `/proc` proof succeeds.
- Missing, malformed, and mismatched identities do not trigger automatic process termination, marker deletion, or application migrations.
- The identity lookup remains bounded and closes its one-shot client on timeout/failure.

Use a deterministic platform-policy seam or native macOS/Windows CI to exercise the non-Linux branch; do not mutate `process.platform` in a shared test process. Keep the existing copied-marker and legitimate-reuse tests.

Setup fixture/Playwright tests must verify the identity warning and recovery hint in English and Korean, with Manual connection still available. Retain keyboard, screen-reader, contrast, and axe checks; verify the recovery copy wraps without horizontal overflow in the documented Setup viewport.

Before claiming completion, run focused persistence and Setup tests, the Carnegie build, changed-file lint/format checks, the repository's full `npm run check`, independent final review, and protected-resource/worktree cleanup audits. Keep provider/live acceptance distinct from fixture evidence.
