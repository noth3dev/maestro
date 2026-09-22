# Ensemble candidate catalog

`ensemble-candidates.example.json` shows the shape of the explicit candidate
catalog consumed by `MAESTRO_ENSEMBLE_CANDIDATE_CATALOG`. It is an example
only: it is never read automatically by the Control Plane, and it contains no
credentials. A real deployment must configure its own catalog path with
account bindings that match its own provider accounts. Acceptance and
integration tests write their own temporary candidate catalog and model map
so both test candidates have matching human baseline profiles and Goal
observations.
