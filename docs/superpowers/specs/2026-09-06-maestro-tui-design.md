# Maestro Terminal TUI Design

**Date:** 2026-09-06  
**Status:** Approved for implementation  
**Product name:** Maestro  
**Conversational identity:** Concertmaster

## Goal

`maestro` is the terminal-native operational surface for the complete Maestro system. Running it inside a project folder opens an interactive Prime Agent-style TUI with a Concertmaster conversation, durable Goal state, live execution activity, approvals, and access to every supported Maestro workflow. It is separate from the Electron desktop app but uses the same Control Plane and typed API contracts.

## Product boundary

- `maestro` with no subcommand opens the interactive TUI.
- `maestro <command>` remains the precise non-interactive command-line interface.
- `maestro --json ...` remains the machine-readable automation surface.
- The Electron desktop application remains a separate client. Its user-facing name is Maestro; Secretary is not a product label.
- Concertmaster remains the CEO-facing conversational identity inside Maestro. Secretary Office remains an architectural/product concept where the plans use it, not the displayed application name.

## Startup and workspace behavior

- The current working directory is the workspace. Detect its Git root when available.
- Do not require users to type an API URL, Project ID, or Goal ID for the normal local flow.
- Reuse a running local Control Plane when present; otherwise prepare/start the local Control Plane and show progress in the TUI.
- Persist connection/authentication state securely. Never print or store bearer secrets in plaintext as a convenience fallback.
- Open the TUI even when AI provider setup is incomplete. State reads and local setup remain available; AI conversation requests explain the missing connection only when needed.
- Reopen the latest session and active Goal for the workspace when available. `/new` starts a new conversation without destroying durable Goal state.
- On startup failure, show a recoverable error with retry and details rather than a raw stack trace.

## Interaction model

The default screen is a Concertmaster conversation with a compact current-state header and an activity timeline. The screen must not hide capabilities; it uses progressive disclosure through overlays, panels, command search, and scrollable detail views.

### Input modes

1. Natural language is interpreted by Concertmaster and routed through the same authenticated Control Plane commands as every other client.
2. Slash commands provide precise access to every supported read and write workflow, with autocomplete and help.
3. Keyboard shortcuts open Goal, event, command, approval, and activity views without pointer input.

Natural-language interpretation must not bypass authorization, project/Goal binding, leases, fencing, idempotency, or critical-action approval.

### Safety behavior

Reads, summaries, and evidence inspection can run immediately. Mutations show the exact action, target, Goal/project, authority/expiry context, expected effect, and rollback information when applicable. Critical actions, external sends, remote Git effects, deployment, payment, permanent deletion, permission/credential changes, and other configured high-impact effects stop for explicit CEO confirmation. Approval and execution use the existing durable command and approval records; the TUI never treats optimistic presentation as success.

### Live activity

Every running operation appears in a timeline with state, actor/role, Goal, start/completion time, current step, cost/usage where available, approvals, evidence links, and failure/recovery guidance. The timeline reconnects from a durable event cursor and does not duplicate events after a terminal disconnect.

## Full capability surface

The TUI must expose the complete supported Maestro surface, not only Goal and Worker basics:

- Overture intake and Task Contract create/read/amend/select-roles/confirm/launch.
- Goal create, list, inspect, transition, pause, resume, stop, emergency stop.
- Head activation and participation state.
- Council create/get, independent brief submit/reveal, and decide.
- Department Plan create/get/revise.
- Mission Bundle create/get and capability/persona context.
- Scout and Execution Worker spawn/get/observe/cancel/accept/certify/conditional certify/request-help.
- Git Goal branch, Department branch, worker worktree, revision, commit/integration and cleanup where exposed by the server.
- Environment recipes, browser/environment execution status, expiry and cleanup.
- Device enrollment, Goal-scoped grants, command dispatch/results, revocation and receipts.
- Discord signal, incident triage, remediation, closure and improvement evidence.
- Budget reservations, actual costs, forecasts, project/Goal summaries and protected floors.
- Metronome scan, challenge, correction, safe-pause and resolve.
- Encore review, certifications, evidence bundles and Concertmaster reports.
- Portfolio/competing-Goal capacity and priority state as those server read/write surfaces land.
- Improvement Digests and later Encore refinement controls with their explicit approval/evidence boundaries.
- Session attach/reconnect and Control Plane restart/recovery status.

A command or panel is not considered exposed merely because a domain function exists. It must be reachable through the TUI, use the typed client, show durable acceptance, and have a safe error/approval state.

## Visual direction

- Dark control-room foundation with restrained Maestro blue accents.
- Amber for approval/warning, red for failure/emergency, muted green for accepted success.
- High information density without decorative ASCII noise.
- Concertmaster conversation is primary; detail appears in panels/overlays.
- Resize uses the terminal's normal re-rendering and scrolling. No separate compact product mode is required.
- All radial/visual relationships have a linear keyboard-accessible representation. TUI operation never depends on a pointer.
- Display name is Maestro throughout the TUI and desktop app. Concertmaster is the visible assistant identity.

## Architecture

```text
maestro TUI
  -> Maestro typed API client
  -> authenticated Control Plane HTTP/SSE
  -> durable PostgreSQL state and command/event records
  -> Prime Agent adapter for execution
```

The TUI owns presentation state only. It does not import persistence internals, call PostgreSQL directly, spawn Prime Agent sessions directly, or create a second scheduler/recovery protocol. Existing Control Plane authorization, command receipts, leases, fencing, evidence, and approval boundaries remain authoritative.

The TUI may start/manage the local Control Plane through a bounded launcher, but server lifecycle and durable reconciliation remain server responsibilities. Long-running work survives TUI exit and is reattached from durable state.

## Delivery boundary

The first implementation must establish a working interactive shell and truthful connection/session behavior before adding every panel. Subsequent slices add the full command and view surface in dependency order. No slice may replace a real unavailable capability with fabricated success or mock operational data.

## Acceptance criteria

- Running `maestro` from a project folder opens the TUI without requiring manual URL/Project/Goal arguments in the normal local path.
- The TUI can display the selected workspace, Goals, approvals, budget, events, and active execution from the typed API.
- Natural language, slash commands, and keyboard shortcuts reach the same server authority path.
- Every existing supported Control Plane capability is reachable through a command, panel, or conversation action, with unsupported/unavailable states explicit.
- Critical actions show exact confirmation and cannot execute without the required approval.
- Live activity reconnects from a durable cursor without loss or duplication.
- Closing and reopening the TUI restores the workspace session and current durable Goal state while server work continues independently.
- TUI, CLI, and Electron clients show the same durable state for representative Goal, hierarchy, budget, Git, evidence, incident, and certification workflows.
- `Secretary` is absent from user-facing product title/copy; `Maestro` is the application name and `Concertmaster` is the conversational identity.
- Focused unit, API/integration, and real-process E2E tests pass; PostgreSQL and Prime Agent verification is required before acceptance.

## Explicit non-goals

- Do not replace Prime Agent with a second model/runtime.
- Do not put database state or authority decisions in the TUI.
- Do not make the Electron app and TUI share renderer code merely for visual consistency.
- Do not add a speculative provider-routing layer or a server-side queue solely for the TUI.
- Do not claim Phase 5 portfolio completion or Phase 6 adaptive mutation merely because a navigation item exists; each capability remains gated by its own plan and evidence.
