# Plan 8 §S3 Reliability Chaos Injection

This suite injects bounded failures at named boundaries and checks the durable result. It does not claim provider behavior that the repository cannot observe.

| Plan boundary | Test / evidence | Expected durable result |
|---|---|---|
| Control-plane termination before commit | `chaos-injection.integration.test.ts` | Transaction rolls back; retry commits once |
| PostgreSQL reconnect / missed notification | `chaos-injection.integration.test.ts` | Durable command receipt and event replay once |
| Native runtime loss | `chaos-injection.test.ts` | No caller-selected fallback in ensemble mode |
| Git response loss after mutation | `chaos-injection.test.ts` | `GitOutcomeUnknownError`; real branch state is retained |
| Discord outage / duplicate | `chaos-injection.integration.test.ts` | Bad delivery rejected; retry accepted once; replay rejected |
| App reconnect / stale command | `chaos-injection.integration.test.ts` | Version conflict; no second event |
| Evidence write failure | `chaos-injection.test.ts` | Capture fails closed before a durable record is returned |

The remaining named boundaries are registered in `chaos-injection.ts` for the next real-process matrix: worker timeout/cancellation/late replies, environment/device disconnect, evaluator/rollout crash, and partial Git conflict. Existing production suites already cover portions of those paths, including worker restart recovery, device-agent unknown recovery, rollout rollback, and SSE reconnect. This slice does not fabricate an evaluator process or a PostgreSQL `LISTEN` consumer; durable event replay remains the source of truth.

Run the focused suite with:

```sh
MAESTRO_TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55434/maestro npm test -- test/phase8-chaos
```
