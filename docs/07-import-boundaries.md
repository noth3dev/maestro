# 07. Import Boundaries

One-line package axes (new files follow the axis; never mix):

- `control-plane/routes/`: per HTTP resource/domain (`registerXRoutes` + `XRouteDeps` in `routes/deps.ts`).
- `api-client`: per-resource `methods/*.ts` + wire-only `transport.ts` + `client.ts` composition.
- `persistence/worker/`: lifecycle verbs (`spawn`, `observe`, `terminal`, `claims`, `recovery`).
- `agent-runtime/ipython/`: protocol-stack layers (`frames` → `validation` → `kernel` → `gateway` → `two-stage`).
- `domain/`: pure invariants only (no DB/HTTP/fs/fetch).

Split `reads.ts` only when it exceeds ~150 lines or gains a fourth dep,
then by resource (`goals/:id/*` vs top-level reads), never by backing service.

Rules enforced by `scripts/check-barrel-boundaries.mjs` (CI static job, zero new deps):

| Scope        | Rule                                                                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| External pkg | `@maestro/*` via barrel index only (`persistence/testing`, `agent-runtime/model-provider` sanctioned)                                           |
| Inside pkg   | `methods/goals` style direct imports allowed                                                                                                    |
| Apps         | `routes/*` direct import; `server.ts` registers only; no `routes/a → routes/b`; `routes/*` touches persistence as `import type` only            |
| Build output | No `dist/` imports except the named process-spawn harness                                                                                       |
| Test seams   | Only `*.integration.test.ts` + named harness may appear in EXCEPTIONS, each with a reason; production code has zero entries; stale entries fail |

Type-only cross-boundary imports are allowed (erased at compile). `test/` and `scripts/` are leaves and out of scope by design.

Commit template for god splits (verbatim, no behavior change):

```text
refactor(<scope>): split <file> god file into <dir>/ modules
(verbatim, no behavior change)
Deps: <what still monolithic> | next: <follow-up>
Boundary: <boundary invariant this commit holds>
```
