# Carnegie

A desktop app (Electron + React) for a local Maestro workspace. At startup, Carnegie uses `@maestro/local-backend` to reuse or start the supported local stack. It does not implement a second stack manager; the shared local-stack launcher remains the source of truth for reuse, readiness, and migrations.

## Branding boundary

The desktop app is **Carnegie**, under the `apps/carnegie` path as the `@maestro/carnegie` workspace package. Maestro remains the product name and namespace. Durable Secretary role/actor identifiers and domain terminology remain unchanged because they are runtime and persistence contracts, not app branding.

## Running it

```sh
npm run --workspace @maestro/carnegie dev
```

This builds the Electron main/preload code, starts the Vite dev server for the renderer, and opens the app window.

On first launch Carnegie attempts local setup automatically. If bootstrap reports `setup-required`, the Setup screen shows the sanitized reason and a local retry button. The retry keeps the manual-form draft in place. Manual setup is a fallback for an already-running loopback Control Plane; a failed bootstrap does not delete the saved connection. The URL and project ID are stored in `connection.json`. The token stays in Electron's main process and is encrypted with `safeStorage` when available; otherwise Carnegie uses the local secret store. The connection can be changed later from Settings → connection, or forgotten from Settings → danger zone.

## Security boundary

The bearer token lives only in the Electron **main** process. The renderer (the React UI) never receives it: it calls `window.maestro.api.*`, which is a `contextBridge`-exposed proxy that forwards to the main process over IPC, where the real `@maestro/api-client` call happens. The saved control-plane URL must be loopback (`127.0.0.1` / `localhost` / `::1`); the Electron store rejects other hosts. This is a local operator tool, not a remote multi-user app.

## Startup recovery and test scope

A `setup-required` bootstrap result routes the renderer to Setup even if an older connection record is still on disk. The error status is sanitized before it crosses IPC. Retry keeps the Setup screen and manual-form draft mounted; its visible label and accessible name stay stable while a status region announces localized progress. Failure returns focus to Retry. Retry success and manual-connect success focus the workspace main landmark. The selected locale also updates the document language. Known database environment errors explain the accepted value and remind operators to restart Carnegie after changing its launch environment. Docker-daemon failures and Docker-container diagnostic failures receive different guidance; unknown failures keep the sanitized reason visible and point to the existing manual-connection fallback.

`src/bootstrap-recovery.playwright.ts` verifies this renderer behavior with a stubbed `window.maestro` bridge, including keyboard focus, WCAG AA contrast, and axe checks in light and dark themes. It is fixture evidence only: it does not test real Electron IPC, the local-stack launcher, keychain isolation, a running Control Plane, PostgreSQL, or provider actions.

## What's real vs. not connected yet

Every screen from the design is present, but only the ones with a real control-plane read/write model behind them are wired up: Goal state, budget, event history, and certifications (Dashboard, Evidence log), and the connection/appearance/danger-zone settings. Screens whose backend doesn't exist yet (Channel, Git diff, Floor, Inbox, Billing, Luthiery, Arrangements, Flashmob) show an honest "not connected yet" state instead of fake data — see each file under `src/views/` for exactly what's missing.

## Native runtime boundary

The React renderer talks to the Control Plane only; it does not call provider APIs directly or create execution admissions. During startup, the Electron main process may reuse or start the local Model Gateway through `@maestro/local-backend`.
