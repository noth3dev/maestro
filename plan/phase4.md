# Phase 4 — Isolated Environments, Enrolled Devices, and Discord Incidents

## Outcome

Extend the certified single-Goal system beyond its local disposable project. Workers gain reproducible task environments and narrowly enrolled device access. Discord operates outside Maestro's primary failure domain and converts verified anomalies into bounded incident workflows.

No tool installation, device enrollment, or Discord signal grants action authority by itself.

## Task-scoped environments

Each environment record contains:

- immutable environment identity and recipe version;
- Goal, Department, worker, project, and mission binding;
- installed capabilities and versions;
- network, filesystem, process, browser, and device boundaries;
- secrets references, never secret values;
- resource ceilings and expiry;
- setup log, health result, and content identity;
- cleanup status and retained evidence.

Build environments from reviewed declarative recipes. Cache only content-addressed layers. Reproduce an environment from its recipe and inputs. A worker sees only assigned project paths and capabilities.

Environment types:

1. local isolated worktree with project-native runtime;
2. container or sandbox for untrusted or conflicting dependencies;
3. browser automation environment;
4. enrolled-device session for explicitly granted local resources.

Use the least complex type that meets isolation and reproducibility. Containers do not replace authority checks.

## Device enrollment and Goal grants

Enrollment establishes device identity and a revocable trust relationship. It does not authorize a Goal.

Flow:

1. CEO explicitly enrolls a device.
2. Device and control plane mutually authenticate.
3. Capabilities are inventoried and reviewed without exposing secrets.
4. For each Goal, Concertmaster requests the smallest grant: action types, project paths, applications, time, data, and network scope.
5. CEO confirmation is required when the grant itself crosses an agreed critical boundary.
6. Worker receives a short-lived capability reference, not a reusable credential.
7. Device validates identity, Goal, target, expiry, fencing token, and policy locally before execution.
8. Commands and results are signed or authenticated, sequenced, and recorded.
9. Grant expires automatically at Goal closure or revocation.

Ordinary in-scope reads, edits, project commands, tests, local app starts, browser operations, and evidence capture may execute then report. External send, deployment, remote push, permanent deletion, permission change, paid action, or broader access remains separately critical.

## Discord architecture

Discord is a separate Node process with its own minimal configuration, health, credential, and append-only local buffer. It must continue detecting and reporting when Maestro's main control plane is unhealthy.

Inputs are allowlisted:

- health endpoints;
- bounded crash and error summaries;
- approved synthetic probes;
- dependency and vulnerability feeds;
- explicit project or runtime resources.

Discord never patches, deploys, changes permissions, or spawns production workers. It emits authenticated, freshness-checked signals with:

- incident fingerprint;
- first and last observation;
- severity and confidence;
- affected component and version;
- minimal reproduction evidence;
- source and freshness;
- deduplication relationship;
- Discord health state.

## Incident workflow

1. Verify authentication, freshness, monitored scope, and replay protection.
2. Deduplicate by fingerprint and affected version.
3. Create or update one incident identity.
4. Produce a bounded Incident Brief, not an unfiltered log dump.
5. Map evidence to the smallest relevant Heads.
6. Activate triage mode with containment first.
7. Produce an Incident Task Contract and Department Plans.
8. Execute isolated remediation through the normal hierarchy and Git model.
9. Quality and required Security/Safety roles certify.
10. Close with resolution, retained risk, false-positive result, and Discord feedback.

High-confidence immediate risk may trigger an automatic safe pause before deliberation. It may not trigger an unapproved external or irreversible repair.

## Technical choices

- Environment recipes remain TypeScript/JSON-schema contracts executed by adapters.
- Local process execution uses argv arrays, cwd allowlists, environment allowlists, timeouts, output caps, and cancellation.
- Browser automation uses Playwright.
- Device transport uses TLS and short-lived opaque capability tokens whose hashes and scope live in PostgreSQL. Do not create bearer tokens with unbounded local authority.
- Node's standard cryptography provides keys, randomness, hashing, and signatures; no custom cryptographic protocol.
- Discord delivery uses an authenticated incident endpoint plus durable local retry buffer.
- Maestro accepts no raw Discord command request; only evidence signals.

## Work sequence

1. Implement environment recipe, capability manifest, build, health, expiry, and cleanup records.
2. Implement local runtime and container/sandbox adapters with authority checks.
3. Implement browser environment and bounded evidence capture.
4. Implement device enrollment, inventory, revocation, and local policy agent.
5. Implement Goal-scoped device grants and short-lived command channel.
6. Implement Discord process, health, buffer, signal schemas, authentication, and replay defense.
7. Implement signal fingerprinting, deduplication, severity/confidence, and silence monitoring.
8. Implement Incident Brief, triage activation, Task Contract, Department Plans, remediation, and closure.
9. Feed incident outcomes and false positives into improvement evidence without enabling automatic changes yet.
10. Run device-scope and seeded-incident live gates.

## Failure and edge cases

- Environment setup partially fails: mark unusable, retain logs, clean only owned resources.
- Environment recipe changes during a mission: existing mission remains bound to old content identity.
- Device disconnects: affected work pauses; independent work may continue.
- Expired device grant receives a late command: device rejects locally.
- Device result arrives after successor work: fencing prevents acceptance.
- Discord sends the same signal repeatedly: update one incident, do not create duplicate Goals.
- Discord is silent: report watchdog-health uncertainty, never infer no incidents.
- Discord itself is compromised or stale: reject signal before organizational activation.
- Vulnerability feed names an unaffected version: record non-applicability with evidence.
- Incident remediation requests deployment: stop at critical approval boundary.
- Raw log contains secrets or excessive private data: redact and summarize before Goal context.

## Tests

1. Rebuild the same environment recipe and verify equivalent capability identity.
2. Worker cannot access an unassigned project path or network target.
3. Installed browser capability without Goal grant cannot operate a device.
4. Device validates Goal, target, expiry, and fencing token independently.
5. Revocation blocks the next command immediately.
6. Disconnection pauses only dependent work.
7. Discord continues buffering while Maestro is stopped and delivers once healthy.
8. Replayed or stale incident signal is rejected.
9. Duplicate signal updates one incident identity.
10. Seeded crash wakes Operations and Engineering only.
11. Seeded vulnerability wakes Security and Engineering.
12. High-confidence danger safe-pauses but does not patch automatically.
13. Incident remediation follows normal Department Plans and certification.
14. Critical deployment remains blocked without exact approval.
15. Discord false positive becomes improvement evidence.
16. Secret-like data is absent from incident context and logs.

## Exit gate

A worker completes one representative browser or enrolled-device task inside a narrow Goal grant while an out-of-scope action is blocked locally. Separately, Discord detects a seeded incident while the main control plane is unavailable, delivers one authenticated deduplicated signal after recovery, activates the correct minimal triage organization, and drives isolated remediation through independent certification without an unapproved critical effect.

## Requirements preserved in this phase

### 10. Virtual environments and external device access — direction under design

- Workers should normally execute inside isolated, task-scoped virtual environments rather than directly in the user's main workspace.
- Environments should support the tools required for the assigned work, including project CLIs and browser or desktop interaction when appropriate.
- A worker's environment and access authority are distinct: having a tool installed does not grant access to the user's computer, credentials, or external services.
- Access to the user's computer or CLI should use an explicitly enrolled device and a bounded, auditable Goal-scoped authority grant.
- The preferred operating model is one-time device enrollment, least-privilege access for each Goal, full command and result audit, and automatic expiry when the Goal ends.
- Noncritical actions within the granted scope may follow execute-then-report. Critical actions remain behind the agreed CEO approval boundary.
- Metronome observes device access, command scope, unexpected side effects, and authority expiry. It may pause execution when the observed behavior escapes the approved Goal scope.

### 11. Enrolled-device automation level

- The CEO enrolls a computer or CLI endpoint once.
- For each Goal, Maestro grants only the access required for the stated outcome and expires that authority when the Goal closes.
- Within an enrolled project scope, workers may automatically read and edit project files, run project CLIs and tests, start local applications, operate a browser, and capture evidence without asking for each action.
- These ordinary actions follow execute-then-report and remain fully audited.
- Access to unrelated personal folders, system-wide changes, external sending, permanent deletion, payment, login or authority changes, or any other critical action stops for CEO approval.
- Device enrollment never implies unrestricted access. A Goal must still establish a bounded scope.
- Metronome may pause access when behavior escapes the Goal, reaches an unexpected resource, or produces side effects outside the granted scope.

### 41. Discord external watchdog — direction under design

**Discord** is an independent external watchdog that runs outside the main Maestro orchestration failure domain.

Purpose:

- Detect when Maestro, Prime Agent integration, an enrolled runtime, or an observed project experiences a crash, persistent health failure, functional regression, bug signal, security vulnerability, dependency exposure, or other actionable anomaly.
- Continue observing and reporting even when Maestro's primary control plane or Encore is unhealthy.
- Convert a detected anomaly into a bounded, evidence-backed incident signal and wake the relevant organizational expertise.

Discord principles:

- It uses least-privilege, primarily read-only monitoring: health endpoints, bounded logs and crash summaries, approved synthetic probes, dependency or vulnerability feeds, and explicit monitored resources.
- It does not directly patch code, change production, expand authority, or spawn execution workers.
- It fingerprints and deduplicates signals, records first and last observation, confidence, severity, affected component and version, reproduction evidence when safe, and source freshness.
- Signals are signed or otherwise authenticated, freshness-checked, replay-resistant, and auditable before Maestro trusts them.
- Crash or reliability evidence maps initially to Operations and Engineering; vulnerability evidence maps to Security and Engineering; user-visible regression evidence may map to Quality, Product, Design, or Engineering as appropriate.
- Discord creates an Incident Brief or a draft Incident Task Contract rather than injecting unbounded raw logs into Department context.
- Concertmaster, Metronome, and the awakened Heads receive the same incident identity so duplicate Goals and duplicate remediation are avoided.
- Discord itself has health, credential expiry, rate, false-positive, and silence monitoring. Absence of Discord data is not treated automatically as absence of incidents.
- Discord findings, triage outcomes, false positives, time to detection, and remediation results feed Encore Improvement Digests.

### 42. Discord triage activation and Head-to-Head calling

- For a high-confidence crash, outage, vulnerability, or comparable incident, Discord may directly wake the relevant existing Department Heads into read-only triage mode.
- Discord notifies Concertmaster and Metronome with the same authenticated incident identity at activation time.
- Lower-confidence or minor signals route first to Concertmaster and Metronome for correlation before waking Departments.
- Triage authority permits evidence collection, reproduction when safe, impact assessment, and an Incident Task Contract draft. It does not permit remediation writes or critical operational effects.
- Actual remediation follows the normal Task Contract, Git, worker, certification, and critical-action rules.

Department Heads may directly call other existing Department Heads:

- The calling Head provides a bounded activation brief: Goal, reason, evidence, requested contribution, urgency, relevant context, and expected budget impact.
- The called Head first joins in assessment or advisory mode and may accept ownership, provide a bounded consultation, request a Scout, or state with evidence that its Department is not relevant.
- Concertmaster updates Council membership, context, scheduling, and budget records but is not a pre-approval gate.
- Direct calling cannot create a new Department, expand permissions, exceed the Goal ceiling, or bypass a critical-action boundary.
- Metronome detects activation loops, duplicate Heads, unjustified expansion, and Departments that remain awake without useful contribution.

### 46. Discord monitoring and notification scope

Initial Discord monitoring is limited to explicitly registered surfaces:

- Maestro control-plane and app health.
- Prime Agent runtime availability and heartbeat.
- Active Goal workers, leases, and abnormal silence or crash signals.
- Explicitly registered local project health endpoints.
- Approved CI results.
- Approved dependency and vulnerability advisory sources.
- Repeated crash and error fingerprints.
- Discord's own heartbeat, credential freshness, data freshness, and observation gaps.

Notification paths:

- During normal operation, Discord reports to the app's Incidents channel, Concertmaster, Metronome, and the relevant Department Heads.
- If Maestro or Prime Agent is unavailable, Discord may use one pre-approved out-of-band emergency channel, such as a dedicated Discord emergency channel or enrolled-device desktop notification.
- The emergency message contains only the incident identity, affected system, severity and confidence, first observation, concise evidence, and safe next action.
- This pre-approval permits bounded emergency notification only. It does not grant Discord remediation, shell execution, broader external messaging, or new-service authority.
