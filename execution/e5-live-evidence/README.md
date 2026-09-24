# E5 live evidence

## Run

- Date: 2026-09-23
- Commit under test for the fresh rerun: `29a3153e` (historical first attempt below references `e6dc7db8`)
- Environment: WSL2; `DISPLAY=:0`, `WAYLAND_DISPLAY=wayland-0`
- Credentials: no token, secret, or credential ID is recorded here.
- Irreversible effects: none. No provider turn, Goal launch, Worker spawn, approval, Git mutation, or external effect was executed.

## Evidence

1. `npm install` restored workspace dependencies already declared by the lockfile (`@playwright/test` and `@earendil-works/pi-tui`). No package manifest or lockfile change resulted.
2. `apps/carnegie` build passed after the Task 12 test-typing repair (`e6dc7db8`). Vite emitted only existing bundle-size and dependency annotation warnings.
3. Carnegie was launched with:

   ```text
   npm run --workspace @maestro/carnegie start -- --remote-debugging-port=9222
   ```

   Electron/CDP became reachable at `http://127.0.0.1:9222`; the target title was `Carnegie`, URL `file:///home/ubuntu/projects/ms/apps/carnegie/dist/renderer/index.html`.
4. The visible renderer exposed `window.maestro.bootstrap.status()` as `setup-required`. The exact boundary was local bootstrap: the existing embedded PostgreSQL-compatible data could not start because PGlite timed out waiting for its mutex. No Control Plane (`4310`), Model Gateway (`4321`), or embedded database (`55433`) listener appeared.
5. A bounded recovery removed only an orphaned embedded-database PID/marker. The original database directory and credentials were not deleted, reset, or rotated. A restart reproduced the same PGlite failure.
6. A disposable fresh-data PGlite probe passed on port `55434` (`READY postgresql://maestro@127.0.0.1:55434/maestro_local`), proving the runtime can start a new database. A copied existing-data probe failed with `RuntimeError: Aborted()`; the original data was untouched.
7. Browser evidence was run against the real Electron CDP target with `MAESTRO_CARNEGIE_CDP_URL=http://127.0.0.1:9222`: all four `tests/e5-a11y.spec.ts` cases reached the renderer but failed/blocked at the unavailable backend boundary (first failure: missing `Primary navigation`; remaining cases timed out while the recovery screen was displayed). No browser success is claimed.
8. The same Playwright command without `MAESTRO_CARNEGIE_CDP_URL` skipped all four tests by design; this is not live evidence.
9. Final Carnegie Playwright command (`npx playwright test --reporter=line`) passed 4 tests and skipped 5 designed CDP-gated tests. The independent Electron radial smoke passed: `RADIAL_SMOKE:{"pass":true,"graph":true,"taskContract":true,"controls":3,"sourceNodes":5}`. Secret-pattern scans over committed E5 evidence/spec files returned zero matches; generated Playwright artifacts were removed.
10. Full-scope secret/artifact scan covered 28 changed/evidence/log files (including Task 14/15 logs): zero high-confidence Bearer/provider-key patterns, zero credential-header assignments, and zero matches against secret-like environment values. `apps/carnegie/test-results` and `playwright-report` were absent after cleanup.
11. Review follow-up at `8c2af5f9` added rendered markup coverage for selected sidebar navigation and Home mode state; the three focused files (`task13-a11y`, `Sidebar`, `Home`) passed 10/10 tests.
12. Heartbeat #16 recheck at `f282458c`: root build and Carnegie build passed; the focused E5/UI suite passed 8 files / 35 tests; exact Carnegie Playwright passed 4 tests with 5 designed CDP skips; `git diff --check` and clean-tree checks passed.

## Result

Task 14 is **backend-blocked at provider/model availability**. The fresh rerun proves local Docker PostgreSQL, Control Plane, Model Gateway, and the visible authenticated Carnegie shell; the real composer request failed with `No Concertmaster model is available` before conversation/Task Contract creation. It produced no Goal, Worker/evidence/certification/report records, provider response, or external effect. The correct status is `backend-blocked`, not `Live`.

## Fresh Task 15 verification (2026-09-23)

- Real PostgreSQL full suite: `/tmp/e5-heartbeat19-full-real-pg.log`; **432 test files passed, 2,874 tests passed, exit code 0**, duration 956.94s.
- Root `npm run build`: exit 0 (`/tmp/e5-final-root-build.log`).
- `npm run --workspace @maestro/carnegie build`: exit 0 (`/tmp/e5-final-carnegie-build.log`).
- Exact Carnegie Playwright: **4 passed, 5 designed CDP-gated skips**, exit 0 (`/tmp/e5-final-playwright.log`).
- Changed-file ESLint and `git diff --check`: exit 0.
- Secret/artifact scan: zero Bearer/provider-key patterns, credential-header assignments, or token-field matches; generated Playwright directories removed.
- These results close the automated verification gap but do not close E5: Task 14 still has no usable Control Plane, embedded database, Model Gateway, or provider listener, and produced no live project/Goal records.
- Independent no-edit review: **PASS** for the current patch with no P0/P1 findings. It confirmed the Playwright-owned exclusion is required because removing it makes Vitest collect Playwright specs and fail. A pre-existing P2 remains: `router-runtime.integration.test.ts` imports constants from `native-worker-acceptance.integration.test.ts`, registering that suite during focused runs; move shared constants to a non-test fixture module in a later cleanup.

## Heartbeat #49 automated verification (2026-09-24)

- After the model-selection slice and compatibility fixes, a fresh unrestricted `npm test` against PostgreSQL `127.0.0.1:55432` passed **440 test files / 2,916 tests**, exit 0, duration **1,001.90s**. Log: `/tmp/maestro-full-test-2.log`.
- This closes the automated regression check only. It does not claim a live provider, Task Contract, Goal, Worker, evidence, certification, report, or E5 completion.

## Fresh Task 14 rerun (2026-09-23)

- The disposable Docker PostgreSQL instance was reachable at `127.0.0.1:55432`. A fresh Carnegie profile was launched without `MAESTRO_API_URL`, with `MAESTRO_LOCAL_DB_ENGINE=docker`, and CDP on `9223`; this exercised the intended local auto-bootstrap path rather than the manual remote-connection path.
- The real visible window reached the authenticated Carnegie Home UI. Bootstrap started the local Control Plane on `4310` and Model Gateway on `4321`; no embedded PGlite mutex failure occurred in this rerun.
- The bounded window capture passed. A documentation-only, no-external-effect request was entered through the visible Home composer. The screenshot shows the real UI state: `conversation not started`, `turn failed`, and `No Concertmaster model is available`.
- No conversation ID, Task Contract ID/version/hash, Goal ID, Worker/evidence/certification/report record, provider response, or external effect exists. The selected project label was visible as `e236ddca`, but no full project ID was copied from secure renderer state after the provider failed.
- The exact blocker is now the configured model/provider catalog, not local database bootstrap or Control Plane reachability. Evidence: `/tmp/e5-live-rerun22-home-after-turn.png`, `/tmp/e5-live-rerun22-turn.log`, `/tmp/e5-live-rerun22-playwright-live.log`.
- The fresh Electron, Control Plane, Model Gateway, and disposable PostgreSQL processes were stopped/removed after capture.
## Fresh live provider-binding retry (2026-09-23)

- Docker-backed local bootstrap recovered with PostgreSQL `55432`, Control Plane `4310`, Model Gateway `4321`, and Carnegie CDP `9225`; the bounded live-window Playwright test passed **1/1**.
- Carnegie Settings completed the real ChatGPT/Codex managed-account binding. Authenticated Model Gateway `GET /v1/models` then returned five real `openai-codex` catalog entries.
- A documentation-only request was entered through the visible Home composer. It created conversation `a352ec21-72fe-4e14-9f23-d35f54fa0f67`; the provider turn completed and returned a real assistant response.
- No Task Contract draft/ID/version/hash, Goal, Worker, evidence, certification, report, or external effect was produced. The current Home intake returns the completed conversation response but does not create a Task Contract draft, so Task 14 Steps 3–6 remain unverified.
- Evidence: `/tmp/e5-live-final2-after-turn.png`, `/tmp/e5-live-final2-terminal.png`, `/tmp/e5-live-final2-turn.log`, `/tmp/e5-live-final2-terminal.log`.
- Correct status: **provider live / Task Contract flow still open**; do not claim E5 or start E6.


## Heartbeat #50 clarification answer implementation (2026-09-24)

- Commit `11e11429` adds the code-level Overture clarification answer round-trip from durable safe events through Control Plane, API client, Electron bridge, and Carnegie Home.
- Focused verification passed **7 files / 75 tests**, including real PostgreSQL Overture persistence (**6 tests**); build, lint, and diff checks passed.
- This is not live provider evidence and does not create a Task Contract, Goal, Worker, report, or external effect.


## Heartbeat #51 automated regression (2026-09-24)

- Unrestricted `npm test` against PostgreSQL `127.0.0.1:55432` passed **440 test files / 2,919 tests**, exit 0, duration **912.60s**. Log: `/tmp/maestro-full-test-3.log`.
- This is automated regression evidence only; no provider, Task Contract, Goal, Worker, certification, report, or external-effect evidence was produced.


## Task 15 role-continuation regression checkpoint (2026-09-24)

After commit `4c02785a`, unrestricted `npm test` against PostgreSQL `127.0.0.1:55432` passed **441 test files / 2,920 tests**, exit 0, duration **916.12s** (`/tmp/maestro-full-test-4.log`). This includes the Overture-owned turn and replay-safe role-continuation integration path. Automated regression is green; live provider, Task Contract, Goal, Worker, and E5 acceptance remain unclaimed.


## Task 16 exact Launch → Goal handoff checkpoint (2026-09-24)

The next narrow slice now couples exact Task Contract Launch to a server-derived Goal in one PostgreSQL transaction. The launch response returns `{ taskContract, goalId, scheduling: "queued" }`. The transaction writes the `GoalCreated` receipt/event, `goal_controls`, and `goal-events` outbox handoff, and marks a linked reviewed Overture Run launched. The nested Overture state event uses its own event-local command ID so the default Launch ID cannot collide with the earlier `task_contract_attached` event. Replay with the same or a new launch command reuses the unique Task Contract→Goal binding without creating a second Goal. Focused PostgreSQL/API/UI/CLI/Overture/surface verification passed **105 tests across 9 files**; `npm run build` passed. This is automated local evidence only: legacy contracts without a linked Overture Run remain supported, while the repository still has no outbox consumer that advances Head/Council/Worker orchestration and live provider access remains unavailable; E5 and E6 are not complete.


## Task 16 automated handoff check (2026-09-24)

This was not a live provider run. The PostgreSQL-backed API integration now verifies that exact Launch writes a scoped `start_goal` orchestration command into the atomic GoalCreated outbox payload. The RED assertion failed before the payload existed; GREEN passed the API integration 1/1, persistence command integration 16/16, and Overture integration 6/6. Root build, typecheck, lint, and diff checks passed. No outbox consumer, provider admission, Head/Council/Department Plan/Mission Bundle/Worker ID, or external effect was produced.


## Router Catalog read-only Electron acceptance (2026-09-25)

- Launched the real Carnegie Electron app on CDP `9222` with a fresh temporary XDG profile and a disposable tmpfs PostgreSQL container on `55444`; the local Control Plane (`4310`) and Model Gateway (`4321`) became ready. The repository branch was `fix/carnegie-domain-browser-hash` at `87173a28`.
- Playwright reached the Home composer and Primary navigation, loaded durable Settings, and opened Settings → Ensemble Router. The live page rendered 7 human-baseline rows. With no candidate catalog configured in the temporary environment, candidate membership and account binding remained explicitly unknown; all 7 `role=switch` controls were disabled. The first switch's `aria-describedby` text explained that candidate membership and account binding were not checked. Status was `Inactive`.
- The captured browser interaction reported no console errors, failed requests, or HTTP errors. The read-only Providers page showed both API-key provider rows as `not connected`; the API-key field was empty, so both `connect` buttons were disabled. OAuth sign-in was not attempted. No credentials were entered, no pool mutation was performed, and no provider turn or external effect was attempted.
- Visual evidence: `/tmp/carnegie-live-router-catalog.png`. Playwright logs: `/tmp/carnegie-live-router-qa-rerun2.log` and `/tmp/carnegie-live-provider-screen.log`.
- Cleanup was verified: Electron and only the Control Plane/Model Gateway process groups started in this run were stopped; the tmpfs-only `maestro-carnegie-live-postgres` container and temporary profile were removed; the `maestro/local-control-plane` keyring entry (absent before the run) was deleted and confirmed absent; the persistent `maestro-local-postgres` on `55432` remained up; environment overrides were restored; ports `4310`, `4321`, `9222`, and `55444` were no longer listening.
- **Scope:** this passes only the fresh-profile, read-only Router Catalog UI slice. It does not verify provider binding in the user's normal profile, a provider response, Task Contract creation, Goal/Worker orchestration, or overall E5 acceptance. Those gates remain open.
