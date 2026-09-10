# Act 1 Phase 4 live acceptance runbook

This harness prepares **Scenario A — narrow grant** and **Scenario B — incident under outage**. It does not start the live gate, activate capabilities, or change `testbed/`. Run live acceptance only as the user, with the existing Control Plane and real provider/device surfaces.

## Prepare the disposable fixture

Run from the repository root. The fixture root must be outside `testbed/`; do not reuse it after the run because its private keys and Discord secret are disposable.

```bash
cd /home/ubuntu/projects/ms
npm run build
export PHASE4_ROOT="${PHASE4_ROOT:-$HOME/.cache/maestro/phase4-$(date +%s)}"
export FIXTURE_ROOT="$(node test/phase4-scenario/create-fixture.mjs "$PHASE4_ROOT")"
cat "$FIXTURE_ROOT/manifest.json"
```

Validate the generated fixture itself before beginning either scenario:

```bash
node test/phase4-scenario/validate-fixture.mjs "$FIXTURE_ROOT"
npm test -- test/phase4-scenario/fixture.test.ts
```

Record these values from `manifest.json`: `goal.goalId`, `goal.projectId`, `device.deviceId`, `device.identityFingerprint`, and `incident.nonce`. Replace `REPLACE_WITH_EXISTING_PROJECT_ID` before using the Goal fixture. Enroll the device through the approved operator enrollment path using only the generated certificate, CA, and public key. Enrollment is inventory; it is not capability authority.

Set the existing deployment values without committing them or writing them into the fixture:

```bash
export MAESTRO_API_URL="${MAESTRO_API_URL:?Set the running Control Plane URL}"
export MAESTRO_API_TOKEN="${MAESTRO_API_TOKEN:?Set an operator bearer token}"
export PROJECT_ID="${PROJECT_ID:?Set the existing project UUID}"
export GOAL_ID="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).goal.goalId)' "$FIXTURE_ROOT/manifest.json")"
export DISCORD_BUFFER_PATH="$FIXTURE_ROOT/discord-buffer.jsonl"
export DISCORD_CREDENTIAL="$(cat "$FIXTURE_ROOT/discord-secret.txt")"
```

## Scenario A — narrow grant

1. Use one existing Goal in `$PROJECT_ID` (or create the Goal through the normal approved flow) and record its ID. Activate **exactly** the manifest capability (`device`) for that Goal with a short expiry, such as ten minutes. Use the current operator/API activation path; do not insert an approval directly into `testbed/` or grant full access.
2. Enroll the disposable device from the manifest, then perform one representative, in-scope device task. Save the request and response under `$FIXTURE_ROOT/evidence/scenario-a/`.
3. Attempt the manifest action whose `scenario` is `narrow-grant`. It is intentionally out of scope (`browser.navigate`). Confirm the request is rejected locally before any network or OS effect. Save the denial reason and an outbound-effect trace.
4. Wait until the activation expires. Retry the same in-scope task. It must be denied even if the model still qualifies.
5. List or inspect active capabilities for the Goal and confirm no browser, deployment, or other capability became usable.

Expected evidence: one exact Goal-scoped activation, one successful in-scope task, one local out-of-scope denial, one post-expiry denial, and no outbound effect for either denial.

## Scenario B — incident under outage

1. Configure the real Discord adapter with the disposable buffer and the target Control Plane URL/token. Keep the buffer on the disposable fixture root:

   ```bash
   export DISCORD_TARGET_API_URL="$MAESTRO_API_URL"
   export DISCORD_TARGET_API_TOKEN="$MAESTRO_API_TOKEN"
   ```

2. Stop the Control Plane. While it is stopped, seed exactly one authenticated incident envelope into the durable adapter buffer. The seed helper refreshes observation/source-freshness timestamps and re-signs the same nonce immediately before append, so the default five-minute freshness window remains meaningful:

   ```bash
   node test/phase4-scenario/seed-incident.mjs "$FIXTURE_ROOT" "$DISCORD_BUFFER_PATH"
   ```

3. Start the Control Plane with the normal deployment command. Start the Discord adapter with the same environment, for example:

   ```bash
   node apps/discord/dist/main.js >"$FIXTURE_ROOT/discord.log" 2>&1 &
   export DISCORD_PID=$!
   ```

   Use the deployment's normal process supervisor instead when applicable. Do not start a second adapter instance.

4. Wait for the Control Plane readiness endpoint, then wait for the adapter flush. Inspect the Control Plane incident records and the buffer. Confirm the nonce in the manifest was delivered exactly once:

   ```bash
   node test/phase4-scenario/verify-incident.mjs "$FIXTURE_ROOT" "$DISCORD_BUFFER_PATH"
   ```

   This helper proves only the local buffer has one delivered record. Separately inspect the Control Plane incident record, minimal-triage event, and certification records; the helper never claims those server-side facts.

5. Confirm only the minimal triage organization activated. Continue remediation through independent certification. Record each evidence ID and certification result under `$FIXTURE_ROOT/evidence/scenario-b/`.
6. Attempt the manifest action whose `scenario` is `incident-under-outage` (`git.push` to `origin/main`). Confirm it is denied and that no critical effect occurred.
7. Stop the disposable adapter, preserve the evidence directory, and remove the generated private-key fixture after the evidence has been archived securely.

Expected evidence: outage-time buffer append, one authenticated delivery for the nonce, no duplicate incident record after restart, minimal triage activation, independent certification, and no unapproved critical effect.

## Stop conditions

Stop immediately and record a finding if any out-of-scope action reaches the network or OS, an incident nonce is delivered more than once, an expired grant is honored, local full-access mode grants an external capability, or a below-requirement model handles incident work without a recorded escalation. Do not retry past a stop condition.

## Handoff record

Live acceptance is user-owned. After both scenarios finish, append the result, evidence paths/IDs, timestamps, and any stop condition to [`roadmap/act-1-foundation/active/operations/findings.md`](../../roadmap/act-1-foundation/active/operations/findings.md). This S4 harness does not certify live acceptance by itself.
