# Work Character and Continuous Pressure

- **Date:** 2026-09-08
- **Status:** Phase 1 artifact, E schema and continuous pressure contract.
- **Parent design:** [Model Pool & Automatic Routing](../active/2026-09-08-model-pool-routing-design.md)
- **Implementation:** `packages/domain/src/work-character.ts`

## 1. Boundary

Work character is separate from required ability. `TaskDemand` says which model capabilities the work needs. E says how much operational pressure and decision scrutiny apply. E never selects a provider/model, changes a D level, or creates a pressure band.

The first implementation uses the same human-readable `0..200` scale as A/D. The scale is a contract for consistent input, not a matching tier.

## 2. Work-character axes

| Axis | `0` means | `200` means | Used by pressure? |
| --- | --- | --- | --- |
| `risk` | negligible damage if wrong | severe damage if wrong | yes |
| `reversibility` | hard or impossible to undo | easy to undo | transformed, as `200 - reversibility` |
| `verificationAttachment` | no attached verification | strong Metronome/Encore verification burden | yes |
| `materialScale` | small bounded context/change | large context/change | no; B/C constraint |
| `timePressure` | no urgency | extreme urgency | no; B/C constraint |
| `budgetHeadroom` | no available cost headroom | ample available cost headroom | no; B/C constraint |

Every value is an integer in `0..200`. The object carries Task Contract and Head decision references. It contains no provider, model, account, authority, or selected route.

## 3. Schema

```ts
interface WorkCharacter {
  schemaVersion: 1;
  risk: number;
  reversibility: number;
  verificationAttachment: number;
  materialScale: number;
  timePressure: number;
  budgetHeadroom: number;
  provenance: {
    taskContractRef: string;
    headDecisionRef: string;
  };
}
```

The validator rejects unknown, inherited, non-enumerable, symbol, missing, non-plain, non-integer, and out-of-range fields. Provenance references are non-empty single-line values.

## 4. Continuous pressure function

The first function is deliberately transparent and equally weighted because no empirical calibration exists yet:

```text
irreversibility = 200 - reversibility
pressure_floor = (risk + irreversibility + verification_attachment) / 3
pressure = max(pressure_floor, explicit_head_uplift)
```

`explicit_head_uplift` is an integer in `0..200`. The returned floor and pressure are finite numbers in `[0,200]`; the floor may be fractional. The function is monotonic in the dangerous direction: higher risk, lower reversibility, higher verification attachment, or higher uplift cannot lower pressure.

The equal weights are an initial transparent policy, not a permanent calibration claim. Any weighting change requires a new reviewed artifact and regression tests.

## 5. Explicit exclusions

This slice does not implement:

- pressure bands or thresholds;
- A↔D capability matching;
- provider facts or operational ranking;
- routing evidence persistence;
- automatic inference of E values from natural language;
- model/provider/account selection.

The next integration slice may bind the validated work character and calculated pressure to the Mission Bundle.
