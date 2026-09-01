# Secretary Office

This is a read-only local Secretary Office shell. It renders durable Goal state and the authenticated control-plane event replay using `@maestro/api-client` on the Next.js server.

## Local-only operator boundary

Set these **server-side** environment variables before starting the app:

```sh
MAESTRO_SECRETARY_API_URL=http://127.0.0.1:4310
MAESTRO_SECRETARY_API_TOKEN=... # local operator bearer secret; never NEXT_PUBLIC_*
MAESTRO_SECRETARY_PROJECT_ID=...
MAESTRO_SECRETARY_GOAL_ID=...
npm run --workspace @maestro/secretary dev
```

Both `dev` and `start` bind the app to `127.0.0.1`. The configuration rejects non-loopback control-plane URLs. The bearer token is read only by server-rendered code and is never returned in page data or browser JavaScript. This is intentionally a local operator boundary, not remote browser authentication. Do not expose this app beyond localhost until a secure browser session design exists.
