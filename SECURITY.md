# Security posture

## Prime Agent archive-extraction advisory

`prime-agent@0.8.0` currently depends on `extract-zip@2.0.1`, which is affected by GHSA-jmr9-qjv8-65gv / CVE-2026-56876. No upstream patched release is available at the time this file was written.

Maestro uses Prime Agent only through its public programmatic SDK on Linux. The supported control-plane path must not invoke Prime Agent interactive mode, agents-view, `main`, or automatic tool bootstrap. The SDK operations used by Maestro (`createAgentSession`, direct RLM children, and skill loading) do not call the affected extraction path.

Until Prime Agent publishes an audited fix:

- deploy Maestro only on Linux;
- leave `PRIME_AGENT_BOOTSTRAP_TOOLS_ON_INSTALL` unset or `0`;
- set `PI_OFFLINE=1` for Maestro's Prime Agent process;
- preinstall and pin trusted `fd` and `rg` in the host image if they are needed;
- do not run Prime Agent interactive mode or agents-view in the Maestro process;
- do not support Windows deployment;
- treat any new call to Prime Agent tool bootstrap as a release-blocking security review.

This is containment, not a claim that the dependency is fixed. The advisory remains audit-visible and blocks a Windows or interactive deployment.
