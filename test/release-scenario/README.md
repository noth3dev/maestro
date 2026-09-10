# Release scenario harness

This directory is the disposable Phase 3 first-usable-release harness. `create-fixture.mjs` creates a real target project below `MAESTRO_WORKTREE_ROOT`; it does not start providers, mutate the repository, or contact remotes. Run `RUNBOOK.md` only after S4 merges and keep the live-provider run for the user handoff.
