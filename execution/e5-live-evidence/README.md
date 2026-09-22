# E5 live evidence

## Run

- Date: 2026-09-23
- Commit under test: `e6dc7db8`
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

## Result

Task 14 is **backend-blocked at local database bootstrap**. It did not produce a project ID, conversation ID, Task Contract ID, Goal ID, Worker/evidence/certification/report records, or provider response. The correct status is `backend-blocked`, not `Live`.
