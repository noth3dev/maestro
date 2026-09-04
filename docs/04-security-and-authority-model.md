# 04. Security & Authority Model

Maestro enforces **Default-Deny** and **Least Privilege** policies across all execution layers, ensuring autonomous agents cannot perform destructive side effects or bypass authorization limits.

---

## 1. Action Classification Matrix

All system actions are categorized into four explicit security levels (`packages/authority/src/authority.ts`):

| Classification | Action Types | Default Security Policy |
| :--- | :--- | :--- |
| **`ordinary`** | `project.file.edit`, `project.test.run`, `git.local.commit` | Allowed autonomously within an active Task Contract and Mission Bundle. |
| **`critical`** | `git.remote.push`, `deployment.release`, `external.send`, `permanent.delete`, `payment.spend`, `authority.change`, `external.connect` | Requires explicit, pre-recorded Conductor / Authority confirmation. |
| **`forbidden`** | `system.policy.bypass`, unauthorized privilege escalation | Permanently blocked. Raises a security audit violation immediately. |
| **`ambiguous`** | Unrecognized or unclassified action strings | Default-denied. Requires explicit classification review before execution. |

---

## 2. The `AuthorizedEffectExecutor` Gateway

All side effects (file modifications, shell commands, network requests) must pass through the `AuthorizedEffectExecutor` gateway:

```mermaid
flowchart TD
    REQ[Agent Action Request] --> GATE[AuthorizedEffectExecutor]
    
    GATE --> CLASS[Action Classification Check]
    CLASS -->|Forbidden / Ambiguous| DENY[Immediate Rejection & Audit Log]
    CLASS -->|Ordinary| CHECK_GRANT{Valid Goal / Mission Grant?}
    CLASS -->|Critical| CHECK_APPROVAL{Valid Pre-recorded Conductor Approval?}
    
    CHECK_GRANT -->|No| DENY
    CHECK_GRANT -->|Yes| AUDIT[Audit Log Written to DB]
    
    CHECK_APPROVAL -->|No| PAUSE[Execution Paused & Conductor Approval Prompted]
    CHECK_APPROVAL -->|Yes| AUDIT
    
    AUDIT --> EXEC[Execute Tool / Side Effect]
    EXEC --> RESULT[Return Result & Store SHA-256 Hash]
```

### Non-negotiable Security Rules
1. **Audit-Before-Effect**: An audit intent record MUST be committed to PostgreSQL *before* the tool or side effect is executed.
2. **Goal & Lease Context Verification**: Requests must present matching `goalId`, `actorId`, and active monotonic fencing tokens. Expired tokens result in immediate rejection.
3. **No Direct System Calls**: Tool adapters (Git, shell, containers) cannot invoke system primitives directly without passing through `AuthorizedEffectExecutor`.

---

## 3. Sealed Submissions & Cryptographic Integrity

To prevent collusion, retroactive goal edits, or hallucinations, Maestro employs a **Sealed Submission Protocol**:

```mermaid
flowchart LR
    INPUT[Task Contract / Brief] --> CANON[Canonical JSON Serialization]
    CANON --> HASH[SHA-256 Content Hash Calculation]
    HASH --> SNAPSHOT[Sealed Submission Snapshot]
    SNAPSHOT --> DB[(PostgreSQL Storage)]
```

* **Canonical JSON Standardization**: Keys are sorted and whitespace is normalized to guarantee consistent SHA-256 hashes across different language runtimes.
* **Immutable Snapshot Binding**: Deliberation briefs, Task Contracts, and Quality certifications bind to `snapshot_hash`. Any modification invalidates downstream execution.
* **Prototype Pollution Guard**: Input parsing strictly rejects dangerous key strings (`__proto__`, `constructor`, `prototype`) with an `InvalidSealedSubmissionSnapshotError`.


## 4. Project access provisioning

Project access changes use `POST /v1/admin/project-access`. The route always authenticates a bearer credential, then checks the requester against the explicit `MAESTRO_OPERATOR_PROVISIONING_ADMIN_ID` configuration. Without that configuration, the route is unavailable. Ordinary project membership checks do not authorize this global operation.

The target must be an active local operator. Requested role IDs are validated against standing immutable `permanent_roles`; arbitrary capabilities and wildcard values are rejected. Membership and every requested role are inserted in one transaction, so a failed role validation cannot leave partial access.
