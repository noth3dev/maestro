# Discord Adapter

Receives authenticated Discord watchdog signals and translates them into durable Maestro incident records. It does not execute provider work or bypass Control Plane authority.

## Run

```sh
npm run build
node apps/discord/dist/main.js
```

The signal credential is configured through the environment and never persisted as evidence.

## Tests

```sh
npm test -- apps/discord/src/discord.test.ts
```

