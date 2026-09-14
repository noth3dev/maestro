# Model Gateway

The credential-owning provider boundary for Maestro. It normalizes model discovery, exact provider/model/account admission, turns, streaming, cancellation, and managed account-login operations.

## Run

```sh
npm run build
MAESTRO_MODEL_GATEWAY_TOKEN=change-me node apps/model-gateway/dist/main.js
```

Provider secrets are supplied to the gateway process or its credential store only. Do not put them in PostgreSQL, Control Plane config output, prompts, evidence, or logs.

## Boundary

The gateway returns opaque bindings, not credentials. The Control Plane must provide the exact model and account binding for each admission.

## Tests

```sh
npm test -- apps/model-gateway/src/rpc.test.ts apps/model-gateway/src/gateway.test.ts
```

