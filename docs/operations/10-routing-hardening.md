# Routing hardening release evidence

## Purpose

Record the property-based routing gates and the evidence bundle for Plan 8 §S7. The tests exercise existing routing, native-admission, conversation, and durable artifact seams without calling a live provider or mutating the human-owned model baseline.

## Exercise

Focused command: `npm test -- test/phase8-routing/routing-hardening-fuzz.test.ts`

Evidence: `/tmp/plan8-s7-routing-final-focused3.log` — exit status `0`; **1/1** file and **12/12** tests passed (11 generated fast-check properties plus one deterministic stale-observation assertion). The suite covers malformed A/B/C/D/E and pressure input, weakest-link routing, hard-gate ordering, single-identity admission, outage/logout/rate-limit fail-closed behavior; a separate stale-observation case records the missing freshness threshold, new-admission mid-run switching, canonical evidence replay/tamper rejection, overlay/baseline isolation, no-candidate escalation, pressure bands, and the production conversation service with explicit in-memory fake database and gateway fixtures. It does not claim a live provider or PostgreSQL conversation run.

Bundle command: `MAESTRO_TEST_DATABASE_URL=postgres://... npm test -- test/phase8-routing/routing-hardening-fuzz.test.ts packages/domain/src/routing-selector.test.ts packages/domain/src/routing-evidence.test.ts packages/domain/src/routing-improvement-candidate.test.ts apps/control-plane/src/ensemble-admission.test.ts apps/control-plane/src/native-admission.test.ts test/phase7-scenario/cli-parity-and-recovery-proof.integration.test.ts packages/persistence/src/ensemble-router-artifacts.test.ts packages/persistence/src/ensemble-router-artifacts.integration.test.ts packages/persistence/src/rollout-controller.integration.test.ts`

Evidence: `/tmp/plan8-s7-routing-evidence-final2.log` — exit status `0`; **10/10** files and **68/68** tests passed. This includes real disposable PostgreSQL artifact reads/append-only migration coverage (**5/5**) and bounded rollout rollback coverage (**9/9**). The Phase 7 parity fixture supplies routing-off disclosure (**8/8**). No live provider or Discord service was called; the PostgreSQL checks used the disposable loopback fixture.

## Current boundary

Status: **partially exercised**. Generated routing evidence is canonical, replayable, and structurally tamper-rejected, and the selected identity remains separate from native binding identity. Provider-result identity equality is not claimed here because the batch does not invoke a live provider or fabricate a provider result. This batch does not claim that an untrusted routing-evidence write is redacted at the domain/persistence boundary; that redaction seam is outside the allowed S7 test-only scope and remains a release blocker. The selector also has no freshness threshold: the stale-observation property records that limitation rather than claiming stale-overlay fail-closed behavior. The bundle reuses existing multi-Goal and pressure evidence rather than claiming a new full-system soak.

## Stop condition

Do not close §S7 or start §S8 until the routing-evidence redaction boundary has an independently verified implementation or an explicit owner-approved scope decision. Do not call a live provider to make this runbook pass.
