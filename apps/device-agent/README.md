# Device Agent App

Process entry point for the device-agent protocol. It exposes the narrow device session and capability channel used by Maestro; it does not own Goal authority or provider credentials.

## Run

```sh
npm run build
node apps/device-agent/dist/main.js
```

Use the device grant/session configuration documented in `src/main.ts`. Commands are sequence-checked and grant-scoped.

## Tests

```sh
npm test -- apps/device-agent/src/main.integration.test.ts packages/device-agent/src/device-agent.test.ts
```

