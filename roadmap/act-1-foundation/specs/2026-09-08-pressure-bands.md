# Pressure Bands

- **Date:** 2026-09-08
- **Status:** Phase 1 artifact, organizational pressure projection.
- **Parent design:** [Ensemble Router — Automatic Routing](../active/2026-09-08-ensemble-router-routing-design.md)
- **Implementation:** `packages/domain/src/pressure-band.ts`

## Boundary

A pressure band is a label over the continuous E pressure value. It projects which organizational layer decides what to do when the route is not satisfied. It is not a model capability tier, a matching threshold, a provider filter, or an authority grant.

## Initial thresholds

| Band | Pressure interval | Decision layer |
| --- | --- | --- |
| `low` | `0 <= pressure < 50` | automatic progress |
| `medium` | `50 <= pressure < 100` | Department Head |
| `high` | `100 <= pressure < 150` | Encore Council |
| `critical` | `150 <= pressure <= 200` | user |

The boundaries are inclusive on the lower side and exclusive on the upper side, except `critical`, which includes `200`. Every valid pressure value maps to exactly one band.

These are initial organizational thresholds, not A↔D matching gates. Changing them changes escalation/reporting behavior only and must not alter model capability scores, task demand levels, provider facts, or native authority.

## Explicit exclusions

This slice does not select a model, lower a TaskDemand, calculate E pressure, grant authority, or persist routing evidence.
