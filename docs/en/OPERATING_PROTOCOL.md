# Maestro — Operating Protocol

Read this file at the start of every session, before doing anything else, whenever
`task_plan.md`'s pointer sends you here. It exists so any session or subagent picking up this
project mid-stream — after an interruption, a context reset, or a brand-new session days later —
behaves identically to the session before it.

## 0. Default engineering discipline

All implementation work in this repo defaults to the Karpathy guidelines: think before coding
(state assumptions, surface tradeoffs, ask when genuinely unclear), simplicity first (minimum
code for the problem, nothing speculative), surgical changes (touch only what the task requires,
match existing style, don't drive-by refactor), goal-driven execution (state verifiable success
criteria, loop until they pass). Apply this to every slice of work in this project, not only to
one-off tasks.

## A. Session resume checklist (in order)

1. Read `task_plan.md` in full — phases, status markers, and "Next step".
2. Read the tail of `progress.md` (last ~5 entries) for the most recent concrete actions/results.
3. Read the tail of `findings.md` (last ~5 entries) for the most recent design/blocker findings.
4. Run `git log --oneline -10` and `git status --short` to confirm the actual repo state matches
   what the docs claim. If they disagree, trust the repo and correct the docs, not the reverse.
5. Do not re-run a subagent audit/slice that the docs already record as done; do not re-litigate
   a decision already recorded under "Errors encountered" or a `## Deferred architecture decision`
   heading without new evidence.

## B. Git hygiene — single-branch-by-default, worktrees are temporary

- `main` is the only branch that persists between sessions. Do not leave long-lived parallel
  branches/worktrees sitting around after their work is merged and verified — this project
  accumulated 16 stale worktrees/branches once already (cleaned up 2026-09-04); do not repeat that.
- Worktree lifecycle for any isolated slice of work: create (`git worktree add .worktrees/<slug>
  -b <branch>`) → implement test-first → self-verify (`npm run build && npm run check`, real
  PostgreSQL when the slice touches persistence) → independent (no-edit) review → merge into
  `main` (or the current integration branch) → re-verify on the merge target → **delete the
  worktree and branch immediately** (`git worktree remove --force .worktrees/<slug>; git branch
  -D <branch>`). Do not let a merged worktree/branch linger "just in case."
- Prefer merging directly to `main` for anything already independently reviewed and verified.
  Only keep a separate long-lived integration branch (like the old `phaseN/integration` pattern)
  while multiple in-flight slices still need to land together before the combined result is
  verified; delete it the same session it merges to `main`.
- **Do not run a fresh `npm install` in every new worktree.** Symlink `node_modules` from `main`
  instead: `ln -s ../../node_modules .worktrees/<slug>/node_modules` (relative symlink, from the
  worktree's own directory). This avoids the disk/time cost of reinstalling the same dependency
  tree per worktree. Caveats, from a real incident on this project (2026-09-03 Phase 4 merge):
  - If the worktree's slice adds or changes a dependency (`package.json`/`package-lock.json`
    diff), run `npm install` in `main` first so the shared `node_modules` reflects it, then
    re-verify `npm run build` in the worktree before continuing.
  - A stale or broken symlink (e.g. left over from a deleted worktree, or pointing at the wrong
    relative depth) causes `ERR_MODULE_NOT_FOUND` at build/test time — if that happens, delete
    the symlink and recreate it, or fall back to a real `npm install` in that worktree for that
    session only.
  - Always confirm the symlink resolves and `npm run build` passes right after creating a new
    worktree, before starting implementation work in it.
- Every local commit stays local. Remote push/merge/release/branch-deletion on `origin` requires
  the user's explicit go-ahead in that session — do not assume a prior push authorization carries
  forward silently, but also do not re-ask if the user already said "push" in the current thread.
- Doc-log merge conflicts (`progress.md`, `task_plan.md`, `findings.md`) are resolved by keeping
  both sides' entries (union), never by discarding either side's history.

## C. Disposable PostgreSQL containers

- Name every disposable container distinctly per task (e.g. `maestro-<slug>-postgres`) and remove
  it (`docker rm -f`) once its verification is done and recorded — do not leave it running for a
  "just in case" re-check. This project accumulated 14 stale containers once already; check
  `docker ps -a --format '{{.Names}}' | grep maestro` at the start of any cleanup pass.
- Never point any command at a shared or production database URL; every integration test in this
  repo drops/truncates its tables.

## D. Subagent (RLM child) spawn rules

1. **Model selection: prefer `openai-codex/gpt-5.6-luna` by default.** Resolve it with
   `rlm.find_models("gpt-5.6-luna")` before first use in a session to confirm the current exact
   selector. If the user explicitly names a different model, use that instead.
2. **Detect a dead/rate-limited child immediately, don't wait it out.** After spawning, check
   `await agent_observe.recent_messages(name, limit=5, max_chars=500)`. If the child's status is
   `idle`/`needs_input` with an empty final assistant message and zero real tool activity, read
   its raw session JSONL under
   `~/.prime/agent/session-artifacts/<parent-session>/<child-id>/*.jsonl` for a provider error
   (look for `errorMessage`/`stopReason: "error"`, e.g. `usage_limit_reached`, 429). A child that
   errored out on every turn produced no work — delete it (`await
   rlm.delete_subagent(handle.name)`) and respawn the same task on the inherited default model
   (`anthropic/claude-sonnet-5` as of this writing) as the fallback, rather than waiting further
   or treating its "completed without reply" notification as a real result. Note in `progress.md`
   which model actually did the work.
3. **Thinking level scales with task difficulty — not fixed.** Routine/mechanical subtasks:
   `medium`. Standard hardening/audit/review work: `high`. An especially deep, critical, or
   security-sensitive single pass: `max`. The caller (the session dispatching the child) picks
   the level per task; do not default every child to the same level regardless of difficulty.
4. **Scope every audit/worker child narrowly and explicitly read-only or explicitly write-scoped.**
   State the worktree/branch it owns (if any), that it must not edit files if the task is an audit,
   and that it must ground every finding in exact file:line evidence.
5. **Always tell an audit child what NOT to re-report.** Point it at the currently open findings
   (e.g. this file's referenced remediation-plan section in `task_plan.md`) so parallel audits
   don't waste a turn re-discovering the same known gaps under a different name.
6. **No child may mark its own work "accepted."** Self-verified/self-reviewed is the ceiling for
   a child that wrote the code; only an independent (no-edit) reviewer — a different child, or the
   parent session reading the diff directly — may accept a slice, per the existing "Commit
   checkpoint policy" below.
7. **Fan-in through files or explicit replies, not silence.** A child must `await
   agent_message.send(..., receiver_role='parent')` when it has an answer. If several children run
   in parallel, wait for each one's real reply (or the dead-child handling in #2) before folding
   its findings into `task_plan.md`/`progress.md` — do not summarize a child's work from its title
   alone.
8. **Record every accepted finding immediately**, in the same turn it's confirmed, into
   `task_plan.md`'s live remediation-plan section and `progress.md` — do not hold multiple
   children's results in conversation memory only, since that is exactly the state lost on an
   interruption.

## E. Commit checkpoint policy

- Create a local commit after each coherent vertical slice clears focused tests, full `npm run
  check`, required disposable-DB integration tests, and independent review.
- Local commits remain noncritical; remote push/merge/release stays behind explicit user
  go-ahead in the current session (see B above).

## F. Local tooling already installed for this project

- `graphify` (via `uv tool install graphifyy`, PATH: `~/.local/bin`) has a code-only knowledge
  graph in `graphify-out/` (gitignored) and post-commit/post-checkout git hooks already installed
  under `.git/hooks/` that rebuild it automatically (AST-only, no LLM key needed, runs detached).
  Re-run `graphify cluster-only . --no-label` manually only if you need a fresh `GRAPH_REPORT.md`/
  `graph.html` outside a commit. Do not reinstall the hook or re-run `graphify hook install`
  unless it is missing (`graphify hook status`).
- Documentation lives in `docs/` (architecture/roadmap/guide, committed) with an explicit
  correction note in `docs/roadmap/phases.md` that Phase 1-4 "complete" means code/test level
  only — keep that note in sync with the remediation plan in `task_plan.md`; do not let the two
  drift apart.
