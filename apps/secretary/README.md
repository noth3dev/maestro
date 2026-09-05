# Secretary

A desktop app (Electron + React) that talks to a Maestro control plane you already have running. It is a client only — it never starts, owns, or manages the control-plane server or PostgreSQL.

## Running it

```sh
npm run --workspace @maestro/secretary dev
```

This builds the Electron main/preload code, starts the Vite dev server for the renderer, and opens the app window.

On first launch it asks for the control-plane URL, an operator bearer token, and a project ID (the same three things `MAESTRO_SECRETARY_API_URL` / `_TOKEN` / `_PROJECT_ID` used to be). They are saved locally — the URL and project ID in a plain preferences file, the token encrypted with the OS keychain via Electron's `safeStorage` — and can be changed later from Settings → connection, or forgotten from Settings → danger zone.

## Security boundary

The bearer token lives only in the Electron **main** process. The renderer (the React UI) never receives it: it calls `window.maestro.api.*`, which is a `contextBridge`-exposed proxy that forwards to the main process over IPC, where the real `@maestro/api-client` call happens. The control-plane URL must be loopback (`127.0.0.1` / `localhost`), same as before — this is a local operator tool, not a remote multi-user app.

## What's real vs. not connected yet

Every screen from the design is present, but only the ones with a real control-plane read/write model behind them are wired up: Goal state, budget, event history, and certifications (Dashboard, Evidence log), and the connection/appearance/danger-zone settings. Screens whose backend doesn't exist yet (Channel, Git diff, Floor, Inbox, Billing, Luthiery, Arrangements, Flashmob) show an honest "not connected yet" state instead of fake data — see each file under `src/views/` for exactly what's missing.
