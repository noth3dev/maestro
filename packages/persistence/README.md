# Persistence

PostgreSQL repositories and transactional orchestration workflows. It owns durable Goal state, leases/fencing, Mission Bundles, workers, council/review records, evidence, certification, device grants, and recovery decisions.

Integration tests require `MAESTRO_TEST_DATABASE_URL`; unit tests run without PostgreSQL.

```sh
MAESTRO_TEST_DATABASE_URL=postgresql://... npm test -- packages/persistence/src/worker.integration.test.ts
```

Credentials and prompts are not persisted. Provider execution is reached only through the injected `ExecutionKernelPort` seam.

