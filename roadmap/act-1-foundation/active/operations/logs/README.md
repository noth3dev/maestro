# Execution logs

This directory contains local command and acceptance logs produced while operating the Act 1 roadmap.

## Policy

- Log files are generated artifacts and remain ignored by Git.
- Use a stable prefix and meaningful scope, for example `phase1-provider-http-full.log`.
- Summarize durable findings, pass/fail counts, environment limits, and cleanup in [`../findings.md`](../findings.md) and [`../progress.md`](../progress.md).
- Do not treat a log file alone as acceptance evidence. The command, environment, result, and limitation must be recorded in the operations ledger.
- Remove empty or superseded logs during the next cleanup pass.
