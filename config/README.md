# Ensemble candidate catalog

By default no catalog file is needed. The Control Plane derives the candidate
set from the live Model Gateway catalog: a live model becomes a candidate only
when `model_map.json` already has a reviewed profile for that exact
`provider/model` identity and the provider has an operator account binding
(`MAESTRO_MODEL_ACCOUNT_REFS`, defaulting to `<provider>-<gateway operator>`).
Live models without a profile are shown as `unprofiled` and are never routed.

`ensemble-candidates.example.json` shows the shape of an explicit candidate
catalog. Setting `MAESTRO_ENSEMBLE_CANDIDATE_CATALOG` to such a file replaces
the derived set, which is useful for pinning a fixed candidate list. The
example is never read automatically, and it contains no credentials.
Acceptance and integration tests write their own temporary candidate catalog
and model map so both test candidates have matching human baseline profiles
and Goal observations.
