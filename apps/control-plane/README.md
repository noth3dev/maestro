# Control Plane

The authoritative Maestro HTTP service. It owns authenticated operator routes, PostgreSQL state transitions, leases/fencing, orchestration, and the `ExecutionKernelPort` composition.

## Run

```sh
npm run build
node apps/control-plane/dist/main.js
```

Native Head/Encore execution requires an explicit provider-qualified `MAESTRO_NATIVE_MODEL`, an authenticated `MAESTRO_MODEL_GATEWAY_TOKEN`, and a matching `MAESTRO_MODEL_ACCOUNT_REFS` binding. Worker models come from the immutable Mission Bundle.

## Boundary

The Control Plane never stores provider credentials. Every native admission carries host context, capability grant, exact model policy, account binding, fencing context, and idempotency. Missing gateway configuration fails closed; there is no alternate execution runtime.

## Tests

```sh
npm test -- apps/control-plane/src/native-gateway-http.integration.test.ts
npm test -- apps/control-plane/src/server.test.ts
```

