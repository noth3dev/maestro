# Security

Maestro keeps provider credentials inside the authenticated Model Gateway. The Control Plane receives opaque bindings and never persists or logs provider secrets.

Execution admissions are host-owned and fail closed. They include the exact provider-qualified model policy, account binding, capability grant, lease context, and idempotency key. Missing gateway configuration exposes no provider fallback.

Report security issues privately to the project maintainers. Do not include credentials, personal data, or production evidence in a report.
