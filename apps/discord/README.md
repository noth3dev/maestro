# Discord Adapter

Receives authenticated Discord watchdog signals and translates them into durable Maestro incident records. It does not execute provider work or bypass Control Plane authority.

## Run

```sh
npm run build
node apps/discord/dist/main.js
```

Required environment:

```sh
export DISCORD_BUFFER_PATH=/var/lib/maestro/discord-buffer.jsonl
export DISCORD_CREDENTIAL=<shared-hmac-secret>
```

Optional delivery and tuning settings:

```sh
export DISCORD_TARGET_API_URL=http://127.0.0.1:4310
export DISCORD_TARGET_API_TOKEN=<operator-bearer-token>
export DISCORD_FLUSH_INTERVAL_MS=1000
export DISCORD_FRESHNESS_WINDOW_MS=300000
```

`DISCORD_CREDENTIAL` signs the watchdog envelope and is never persisted as evidence. The target URL/token enable delivery to the authenticated Control Plane; omitting them keeps signals in the append-only local buffer.

## Tests

```sh
npm test -- apps/discord/src/discord.test.ts
```

