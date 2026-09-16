# Plan 8 §S8 soak and long-running operation

## Purpose

Run the sustained-operation harness around the frozen release candidate. The runner writes a content-addressed JSON report rather than treating one command exit code as soak evidence.

## Exercise

The current safe exercise uses a deterministic disposable fixture. It covers multiple concurrent Goals, scheduled idle evaluation, app disconnect/reconnect, provider rotation and controlled unavailability, a periodic control-plane generation restart, Discord probes, persona evidence, and resource/cost/storage samples.

```sh
npm run build
node scripts/run-soak.mjs \
  --report /tmp/plan8-s8-soak-report.json \
  --duration 24 \
  --sample-interval 2 \
  --goal-count 3 \
  --candidate-id phase8-s8-disposable-candidate-v1 \
  --seed 7 \
  --timeline-origin 2026-09-16T00:00:00.000Z
```

Evidence: `/tmp/plan8-s8-soak-run-final3.log` — exit status `0`; report content hash `e0d9f2dafd99095262a9640b08fbb9820e2df3df741e443753e61eb4c7ca716f`; report mode `0600`; **13/13** logical samples; `idleObligationSamples=13`, `scopeSamples=13`, `personaBoundSamples=13`, and no violations. The report endpoint is the configured `2026-09-16T00:00:00.024Z` timeline endpoint, so the configured window is sampled rather than only its start and end states.

The report is atomically written beside its destination through a `0600` temporary file and rename. An exclusive `0600` lock prevents concurrent writers from silently overwriting the report; a lock owned by a dead process is reclaimed, while an unreadable lock fails closed. After confirming no runner is active, an operator may remove the documented `.lock` path after an abrupt termination. It records its fixture identity, candidate identity, seed, configuration, logical timeline, sample source of truth, assertion results, boundary modes, limitations, observation digest, and canonical content hash. `replaySoakReport()` validates and reruns the recorded fixture identity; the test also rejects a tampered sample hash.

## Current boundary

Status: **fixture evidence only**. The report's provider boundary is `fake-loopback` with `live=false` and zero provider calls. The Discord boundary is `synthetic-test-observation` with `live=false`. The control-plane restart is a deterministic generation transition with `processRestarted=false`; no five-process restart is claimed. The in-memory Goal, obligation, scope, persona, and metric projections prove the runner's per-sample gates, not production PostgreSQL lease/grant/environment/device behavior.

The full real soak remains pending. It requires disposable production services, real concurrent Goals, scheduled Metronome/idle work, app and control-plane restart, provider and Discord fixtures, and resource/cost/storage observation. Live provider-result identity, live Discord detection, and screen-reader acceptance remain separate gates.

## Stop condition

Do not mark §S8 complete from the disposable fixture. A completion report must include real service identities and evidence for every listed content item, and test the no-idle and scope-expiry assertions at every sampled point across that real window. Keep the fixture report as runner/regression evidence only.
