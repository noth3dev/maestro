# CLI

Terminal client for the authenticated Maestro Control Plane. It is a presentation and operator-command surface, not an execution runtime and not a credential store.

## Run

```sh
npm run build
node apps/cli/dist/main.js --help
```

Configure the Control Plane URL and operator token through the documented local connection flow. Provider credentials stay in the Model Gateway.

## TUI boundary

The TUI renders authoritative Goal, event, worker, review, certification, and recovery state returned by the API client. It does not maintain a second durable state model. SSE reconnects use the server cursor; disconnects and gateway failures are shown as explicit UI states rather than guessed results. Keyboard commands become authenticated Control Plane commands and remain subject to the same lease, fencing, capability, approval, and idempotency checks as every other client.

## Tests

```sh
npm test -- apps/cli/src/main.test.ts apps/cli/src/tui
```

