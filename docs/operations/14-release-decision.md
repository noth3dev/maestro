# Plan 8 §S10 release decision and rollback

## Current status

**Blocked.** Probe evidence: `/tmp/plan8-s10-decision-20260916.json`, command exit `2`, recommendation `do_not_release`. The S9 report currently has `status=blocked` because only mapped component suites are available. S10 refuses a release recommendation until all eleven live records pass on one frozen candidate. No critical-finding override exists.

## Decision gate

Prepare a gate manifest with every required boolean, the same S9 `candidateId`/`checkpointId`/`runId`, and one SHA-256 `gateEvidence` value per demonstrated gate. The S9 report `contentHash` must be the canonical hash emitted by the runner. Add final-report metadata, then run:

```sh
node scripts/release-decision.mjs \
  --scenario-report /path/to/phase8-s9-scenarios.json \
  --gate-manifest /path/to/release-gates.json \
  --report /path/to/release-decision.json
```

The command exits `2` and records `do_not_release` when S9 is blocked, any gate is false, or a critical finding exists. It exits `0` only for a complete live evidence bundle with supported scope, disabled capabilities, known limitations, costs, confidence, and dissent. It never publishes, deploys, pushes, or enables an external effect.

## Rollback

Rollback is executable only when a failed-scenario record, candidate, evidence, state, and all three rerun commands are supplied in a disposable manifest:

```sh
node scripts/release-rollback.mjs --input /path/to/rollback-manifest.json --report /path/to/rollback-report.json
```

The protocol preserves candidate/evidence copies, stops progression, disables external and improvement authority, pauses active test Goals, then runs the failed scenario, phase gate, and full regression commands without a shell. Missing inputs return `status=blocked`; no successful rollback is fabricated.
