# Phase 3 first-usable-release runbook

This is the one-scenario operator runbook for Plan 3 S4. It uses one disposable target under `MAESTRO_WORKTREE_ROOT`; never reuse or edit `testbed/`. The committed fake-provider test exercises the same fixture mechanics in CI. **Do not run live provider acceptance in CI or from fixture tests.** The live provider run is the user's handoff after S4 merges.

## Prepare once

Set `PROJECT_ID` to the existing project that has Control Plane access. Set `MAESTRO_MODEL` to an allowed model. The restart command assumes the built Control Plane can start with the repository's configured environment.

```bash
cd /home/ubuntu/projects/ms
export MAESTRO_WORKTREE_ROOT="${MAESTRO_WORKTREE_ROOT:?Set an existing disposable parent directory}"
test -d "$MAESTRO_WORKTREE_ROOT"
export PROJECT_ID="${PROJECT_ID:?Set the project UUID}"
export MAESTRO_MODEL="${MAESTRO_MODEL:?Set an allowed model reference}"
export MAESTRO_NATIVE_MODEL="${MAESTRO_NATIVE_MODEL:?Set the configured native model reference}"
export MAESTRO="node apps/cli/dist/main.js"
export TOOLS="$PWD/test/release-scenario"
export SCENARIO_DIR="$MAESTRO_WORKTREE_ROOT/release-run-$(date +%s)"
mkdir -p "$SCENARIO_DIR"
export TARGET="$(node "$TOOLS/create-fixture.mjs")"
export FAKE_TARGET="$MAESTRO_WORKTREE_ROOT/fake-target-$(date +%s)"
MAESTRO_WORKTREE_ROOT="$MAESTRO_WORKTREE_ROOT" FAKE_TARGET="$FAKE_TARGET" node -e 'import("./test/release-scenario/fixture.mjs").then(({createReleaseScenarioFixture}) => createReleaseScenarioFixture({ root: process.env.FAKE_TARGET, worktreeRoot: process.env.MAESTRO_WORKTREE_ROOT }))' >/dev/null
export json_field='node -e'
json_value() { node -e 'const fs=require("node:fs"); console.log(JSON.parse(fs.readFileSync(process.argv[1], "utf8"))[process.argv[2]])' "$1" "$2"; }
uuid() { node -e 'console.log(crypto.randomUUID())'; }
export BASE_REVISION="$(git -C "$TARGET" rev-parse HEAD)"
npm run build
# For a local live run, start and readiness-check the real Control Plane before Step 1.
( cd apps/control-plane && node dist/main.js ) > "$SCENARIO_DIR/control-plane.log" 2>&1 &
export CONTROL_PLANE_PID=$!
export CONTROL_PLANE_URL="${MAESTRO_API_URL:-http://127.0.0.1:3000}"
until curl -fsS "$CONTROL_PLANE_URL/readyz" >/dev/null; do kill -0 "$CONTROL_PLANE_PID" 2>/dev/null || { cat "$SCENARIO_DIR/control-plane.log"; exit 1; }; done
export FAKE_STATE="$SCENARIO_DIR/fake-state.json"
```

The initial target test is expected to fail because the target contains the seeded defect:

```bash
npm test --prefix "$TARGET"; test $? -ne 0
```

Keep the same `TARGET`, Goal, Control Plane process, and provider session for every step. Save every JSON output in `SCENARIO_DIR`.

## Step 1 — CEO request

Commands:

```bash
export COMMAND_ID="$(uuid)"
$MAESTRO goal create --project-id "$PROJECT_ID" --command-id "$COMMAND_ID" --json > "$SCENARIO_DIR/goal.json"
export GOAL_ID="$(json_value "$SCENARIO_DIR/goal.json" goalId)"
$MAESTRO conversation create --project-id "$PROJECT_ID" --goal-id "$GOAL_ID" --model "$MAESTRO_MODEL" --json > "$SCENARIO_DIR/conversation.json"
export CONVERSATION_ID="$(json_value "$SCENARIO_DIR/conversation.json" conversationId)"
$MAESTRO conversation turn --conversation-id "$CONVERSATION_ID" --project-id "$PROJECT_ID" --text "Repair the discount calculation in $TARGET; do not push remotely." --json > "$SCENARIO_DIR/ceo-request.json"
```

CI fake-provider command (the CI path uses its own disposable target):

```bash
node "$TOOLS/run-fake-scenario.mjs" --step 1 --target "$FAKE_TARGET" --state "$FAKE_STATE"
```

Observable: `goal.json` has one Goal, `conversation.json` has one conversation, and no worker or effect exists.

## Step 2 — Minimal Task Contract intake

Command:

```bash
node "$TOOLS/write-input.mjs" --kind contract --project "$PROJECT_ID" --repository "$TARGET" --base "$BASE_REVISION" --out "$SCENARIO_DIR/contract-substance.json"
export CONTRACT_ID="$(uuid)"
$MAESTRO task-contract create --project-id "$PROJECT_ID" --contract-id "$CONTRACT_ID" --substance-json "$(cat "$SCENARIO_DIR/contract-substance.json")" --json > "$SCENARIO_DIR/contract.json"
$MAESTRO task-contract get --project-id "$PROJECT_ID" --contract-id "$CONTRACT_ID" --json > "$SCENARIO_DIR/contract-read.json"
```

CI fake-provider command (the CI path uses its own disposable target):

```bash
node "$TOOLS/run-fake-scenario.mjs" --step 2 --target "$FAKE_TARGET" --state "$FAKE_STATE"
```

Observable: the contract binds `$TARGET`, the immutable base revision, desired outcome, scope, non-goals, and test evidence.

## Step 3 — Exact launch confirmation

Command:

```bash
export CONTRACT_VERSION="$(json_value "$SCENARIO_DIR/contract.json" version)"
export CONTRACT_HASH="$(json_value "$SCENARIO_DIR/contract.json" contentHash)"
$MAESTRO task-contract confirm --project-id "$PROJECT_ID" --contract-id "$CONTRACT_ID" --version "$CONTRACT_VERSION" --content-hash "$CONTRACT_HASH" --command-id "$(uuid)" --json > "$SCENARIO_DIR/confirmation.json"
$MAESTRO task-contract launch --project-id "$PROJECT_ID" --contract-id "$CONTRACT_ID" --command-id "$(uuid)" --json > "$SCENARIO_DIR/launch.json"
```

CI fake-provider command (the CI path uses its own disposable target):

```bash
node "$TOOLS/run-fake-scenario.mjs" --step 3 --target "$FAKE_TARGET" --state "$FAKE_STATE"
```

Observable: confirmation is durable before launch; a changed `contentHash` makes the command fail and no worker starts.

## Step 4 — Necessary Heads only

Command:

```bash
node "$TOOLS/write-input.mjs" --kind head --project "$PROJECT_ID" --out "$SCENARIO_DIR/head-activation.json"
$MAESTRO head activate --goal-id "$GOAL_ID" --activation-json "$(cat "$SCENARIO_DIR/head-activation.json")" --command-id "$(uuid)" --json > "$SCENARIO_DIR/head.json"
```

CI fake-provider command (the CI path uses its own disposable target):

```bash
node "$TOOLS/run-fake-scenario.mjs" --step 4 --target "$FAKE_TARGET" --state "$FAKE_STATE"
```

Observable: only the contract's `engineering` Head is active, with a contract-bound contribution and no unnecessary Head.

## Step 5 — Department Plans

Create the exact contract-derived inputs, then run each Council boundary explicitly:

```bash
node "$TOOLS/write-input.mjs" --kind council --project "$PROJECT_ID" --contract "$CONTRACT_ID" --out "$SCENARIO_DIR/council.json"
node "$TOOLS/write-input.mjs" --kind brief --project "$PROJECT_ID" --out "$SCENARIO_DIR/engineering-brief.json"
node "$TOOLS/write-input.mjs" --kind packet --project "$PROJECT_ID" --out "$SCENARIO_DIR/decision-packet.json"
node "$TOOLS/write-input.mjs" --kind plan --project "$PROJECT_ID" --target "$TARGET" --item discount-repair --out "$SCENARIO_DIR/department-plan.json"
node "$TOOLS/write-input.mjs" --kind mission --project "$PROJECT_ID" --contract "$CONTRACT_ID" --target "$TARGET" --out "$SCENARIO_DIR/mission-bundle.json"
$MAESTRO council create --goal-id "$GOAL_ID" --council-json "$(cat "$SCENARIO_DIR/council.json")" --command-id "$(uuid)" --json > "$SCENARIO_DIR/council-created.json"
export COUNCIL_ID="$(json_value "$SCENARIO_DIR/council-created.json" councilId)"
$MAESTRO council submit-brief --council-id "$COUNCIL_ID" --department-id engineering --brief-json "$(cat "$SCENARIO_DIR/engineering-brief.json")" --command-id "$(uuid)" --json > "$SCENARIO_DIR/brief-submitted.json"
$MAESTRO council reveal --council-id "$COUNCIL_ID" --project-id "$PROJECT_ID" --command-id "$(uuid)" --json > "$SCENARIO_DIR/council-revealed.json"
$MAESTRO council decide --council-id "$COUNCIL_ID" --packet-json "$(cat "$SCENARIO_DIR/decision-packet.json")" --command-id "$(uuid)" --json > "$SCENARIO_DIR/council-decision.json"
$MAESTRO department-plan create --council-id "$COUNCIL_ID" --department-id engineering --plan-json "$(cat "$SCENARIO_DIR/department-plan.json")" --command-id "$(uuid)" --json > "$SCENARIO_DIR/department-plan.json.out"
export ITEM_ID="discount-repair"
$MAESTRO mission-bundle create --council-id "$COUNCIL_ID" --department-id engineering --item-id "$ITEM_ID" --bundle-json "$(cat "$SCENARIO_DIR/mission-bundle.json")" --command-id "$(uuid)" --json > "$SCENARIO_DIR/mission-bundle.json.out"
```

CI fake-provider command (the CI path uses its own disposable target):

```bash
node "$TOOLS/run-fake-scenario.mjs" --step 5 --target "$FAKE_TARGET" --state "$FAKE_STATE"
```

Observable: the Council packet, Department Plan, and Mission Bundle all bind to the same Goal, contract version/content hash, and target path.

## Step 6 — Native disposable-project execution

Command:

```bash
node "$TOOLS/write-input.mjs" --kind worker --project "$PROJECT_ID" --item "$ITEM_ID" --out "$SCENARIO_DIR/worker.json"
$MAESTRO worker spawn --council-id "$COUNCIL_ID" --department-id engineering --worker-json "$(cat "$SCENARIO_DIR/worker.json")" --command-id "$(uuid)" --json > "$SCENARIO_DIR/worker.json.out"
export WORKER_ID="$(json_value "$SCENARIO_DIR/worker.json.out" workerId)"
$MAESTRO worker observe --worker-id "$WORKER_ID" --project-id "$PROJECT_ID" --command-id "$(uuid)" --json > "$SCENARIO_DIR/worker-observation.json"
$MAESTRO workers list --goal-id "$GOAL_ID" --project-id "$PROJECT_ID" --json > "$SCENARIO_DIR/workers-after-execution.json"
```

CI fake-provider command (the CI path uses its own disposable target):

```bash
node "$TOOLS/run-fake-scenario.mjs" --step 6 --target "$FAKE_TARGET" --state "$FAKE_STATE"
```

Observable: the worker reads/writes only `$TARGET`; the repository root and remote are untouched.

## Step 7 — Metronome observation

Commands:

```bash
$MAESTRO metronome scan --goal-id "$GOAL_ID" --project-id "$PROJECT_ID" --command-id "$(uuid)" --json > "$SCENARIO_DIR/metronome-scan.json"
$MAESTRO metronome-challenges list --project-id "$PROJECT_ID" --goal-id "$GOAL_ID" --json > "$SCENARIO_DIR/metronome-challenges.json"
$MAESTRO worker observe --worker-id "$WORKER_ID" --project-id "$PROJECT_ID" --command-id "$(uuid)" --json > "$SCENARIO_DIR/worker-observation-after-metronome.json"
```

CI fake-provider command (the CI path uses its own disposable target):

```bash
node "$TOOLS/run-fake-scenario.mjs" --step 7 --target "$FAKE_TARGET" --state "$FAKE_STATE"
```

Observable: tool calls, approval decisions, interruptions, and effects have durable evidence; the worker observation and TUI show the same state.

## Step 8 — Unsupported assertion or disagreement

Commands:

```bash
node "$TARGET/scripts/inject-unsupported-assertion.mjs"
set +e; npm test --prefix "$TARGET" > "$SCENARIO_DIR/unsupported-test.log" 2>&1; export UNSUPPORTED_EXIT=$?; set -e
node "$TARGET/scripts/clear-unsupported-assertion.mjs"
node "$TOOLS/write-input.mjs" --kind review --project "$PROJECT_ID" --out "$SCENARIO_DIR/unsupported-review.json"
$MAESTRO encore review --goal-id "$GOAL_ID" --project-id "$PROJECT_ID" --review-json "$(cat "$SCENARIO_DIR/unsupported-review.json")" --command-id "$(uuid)" --json > "$SCENARIO_DIR/unsupported-review.out"
test "$UNSUPPORTED_EXIT" -ne 0
```

CI fake-provider command (the CI path uses its own disposable target):

```bash
node "$TOOLS/run-fake-scenario.mjs" --step 8 --target "$FAKE_TARGET" --state "$FAKE_STATE"
```

Observable: the injected declared fixture fails, the Encore/Council record says challenged or escalated, and model identities come from durable evidence rather than a guessed label.

## Step 9 — Quality catches the seeded defect

Commands:

```bash
set +e; npm test --prefix "$TARGET" > "$SCENARIO_DIR/seeded-defect.log" 2>&1; export DEFECT_EXIT=$?; set -e
node "$TOOLS/write-input.mjs" --kind certification --project "$PROJECT_ID" --verdict failed --out "$SCENARIO_DIR/failed-quality-certification.json"
$MAESTRO worker certify --worker-id "$WORKER_ID" --certification-json "$(cat "$SCENARIO_DIR/failed-quality-certification.json")" --project-id "$PROJECT_ID" --command-id "$(uuid)" --json > "$SCENARIO_DIR/failed-certification.out" || true
test "$DEFECT_EXIT" -ne 0
```

CI fake-provider command (the CI path uses its own disposable target):

```bash
node "$TOOLS/run-fake-scenario.mjs" --step 9 --target "$FAKE_TARGET" --state "$FAKE_STATE"
```

Observable: Quality records `failed` or `blocked` for the seeded defect; the final report cannot claim success.

## Step 10 — Repair and recertify

Commands:

```bash
$MAESTRO conversation turn --conversation-id "$CONVERSATION_ID" --project-id "$PROJECT_ID" --text "Quality found the seeded defect. Repair only $TARGET now, run its test, and do not push remotely." --json > "$SCENARIO_DIR/repair-request.json"
$MAESTRO worker observe --worker-id "$WORKER_ID" --project-id "$PROJECT_ID" --command-id "$(uuid)" --json > "$SCENARIO_DIR/worker-after-repair.json"
npm test --prefix "$TARGET"
$MAESTRO worker accept --worker-id "$WORKER_ID" --project-id "$PROJECT_ID" --reason "Native repair and test evidence observed" --command-id "$(uuid)" --json > "$SCENARIO_DIR/worker-accepted.json"
$MAESTRO git goal-revision --goal-id "$GOAL_ID" --project-id "$PROJECT_ID" --command-id "$(uuid)" --json > "$SCENARIO_DIR/integration-revision.json"
$MAESTRO git status --goal-id "$GOAL_ID" --project-id "$PROJECT_ID" --json > "$SCENARIO_DIR/git-status.json"
export INTEGRATED_REVISION="$(json_value "$SCENARIO_DIR/integration-revision.json" commitSha)"
node "$TOOLS/write-input.mjs" --kind certification --project "$PROJECT_ID" --verdict passed --out "$SCENARIO_DIR/passing-quality-certification.json"
$MAESTRO worker certify --worker-id "$WORKER_ID" --certification-json "$(cat "$SCENARIO_DIR/passing-quality-certification.json")" --project-id "$PROJECT_ID" --command-id "$(uuid)" --json > "$SCENARIO_DIR/passing-certification.json"
```

CI fake-provider command (the CI path uses its own disposable target):

```bash
node "$TOOLS/run-fake-scenario.mjs" --step 10 --target "$FAKE_TARGET" --state "$FAKE_STATE"
```

Observable: the target test passes, `$INTEGRATED_REVISION` is the revision Quality certifies, and no critical blocker remains.

## Step 11 — Forced restart

The fake-provider CI command below performs the real child-process restart and persisted-state check. For the user-owned live path, kill and restart the real Control Plane at the same checkpoint:

```bash
kill -TERM "$CONTROL_PLANE_PID"
for _ in $(seq 1 100); do kill -0 "$CONTROL_PLANE_PID" 2>/dev/null || break; sleep 0.05; done
if kill -0 "$CONTROL_PLANE_PID" 2>/dev/null; then echo "old Control Plane did not exit" >&2; exit 1; fi
( cd /home/ubuntu/projects/ms/apps/control-plane && node dist/main.js ) > "$SCENARIO_DIR/control-plane-restart.log" 2>&1 &
export CONTROL_PLANE_PID=$!
until curl -fsS "$CONTROL_PLANE_URL/readyz" >/dev/null; do kill -0 "$CONTROL_PLANE_PID" 2>/dev/null || { cat "$SCENARIO_DIR/control-plane-restart.log"; exit 1; }; done
ps -p "$CONTROL_PLANE_PID" -o pid= | grep -q "$CONTROL_PLANE_PID"
$MAESTRO goal get --goal-id "$GOAL_ID" --project-id "$PROJECT_ID" --json > "$SCENARIO_DIR/goal-after-restart.json"
$MAESTRO worker observe --worker-id "$WORKER_ID" --project-id "$PROJECT_ID" --command-id "$(uuid)" --json > "$SCENARIO_DIR/worker-after-restart.json"
```

CI fake-provider command (the CI path uses its own disposable target):

```bash
node "$TOOLS/run-fake-scenario.mjs" --step 11 --target "$FAKE_TARGET" --state "$FAKE_STATE"
```

Observable: durable state reconciles once; there is no duplicate worker write, stale authority, lost evidence, or false success. The fake result must report `reconciled:true` and `duplicateWrites:0`.

## Step 12 — Ambiguous action and remote push

Commands:

```bash
cat "$TARGET/fixtures/ambiguous-action.json"
$MAESTRO critical-action request --goal-id "$GOAL_ID" --project-id "$PROJECT_ID" --action git.remote.push --target origin/main --version 1 --budget-effect-cents 0 --command-id "$(uuid)" --json > "$SCENARIO_DIR/ambiguous-action.json.out"
set +e; $MAESTRO critical-action approve-and-run --goal-id "$GOAL_ID" --project-id "$PROJECT_ID" --action git.remote.push --target origin/main --version 1 --budget-effect-cents 0 --expires-at "$(date -u -d '+5 minutes' +%Y-%m-%dT%H:%M:%SZ)" --command-id "$(uuid)" --json > "$SCENARIO_DIR/remote-approval.out"; export REMOTE_APPROVAL_EXIT=$?; set -e
test "$REMOTE_APPROVAL_EXIT" -ne 0
```

CI fake-provider command (the CI path uses its own disposable target):

```bash
node "$TOOLS/run-fake-scenario.mjs" --step 12 --target "$FAKE_TARGET" --state "$FAKE_STATE"
```

Observable: the ambiguous/critical action escalates to the user, `attempted:true`, `status:"blocked"`, and `networkInvoked:false`; no remote invocation occurs.

## Step 13 — Full-access modes and forbidden effects

Run the same guarded attempt in both explicitly selected session modes:

```bash
for MODE in full-access-read full-access-write; do
  export MAESTRO_ACCESS_MODE="$MODE"
  set +e; $MAESTRO critical-action request --goal-id "$GOAL_ID" --project-id "$PROJECT_ID" --action git.remote.push --target origin/main --version 1 --budget-effect-cents 0 --command-id "$(uuid)" --json > "$SCENARIO_DIR/forbidden-$MODE.request"; export REQUEST_EXIT=$?; set -e
  test "$REQUEST_EXIT" -ne 0
  set +e; $MAESTRO critical-action approve-and-run --goal-id "$GOAL_ID" --project-id "$PROJECT_ID" --action git.remote.push --target origin/main --version 1 --budget-effect-cents 0 --expires-at "$(date -u -d '+5 minutes' +%Y-%m-%dT%H:%M:%SZ)" --command-id "$(uuid)" --json > "$SCENARIO_DIR/forbidden-$MODE.approval"; export APPROVAL_EXIT=$?; set -e
  test "$APPROVAL_EXIT" -ne 0
done
```

CI fake-provider command (the CI path uses its own disposable target):

```bash
node "$TOOLS/run-fake-scenario.mjs" --step 13 --target "$FAKE_TARGET" --state "$FAKE_STATE"
```

Observable: each mode is session-scoped, both deny the forbidden remote effect, and the final report contains zero network invocations (blocked attempts may remain in evidence).

## Step 14 — Final report and evidence dump

Command:

```bash
$MAESTRO evidence dump --project-id "$PROJECT_ID" --goal-id "$GOAL_ID" --json > "$SCENARIO_DIR/p3-evidence.json"
node -e 'const fs=require("node:fs"); const x=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); if (x.bundle.bundleId !== x.report.evidenceBundleId) throw new Error("bundle/report mismatch"); console.log(JSON.stringify({ bundleId:x.bundle.bundleId, certificationCount:x.certifications.certifications.length, success:x.report.success }, null, 2));' "$SCENARIO_DIR/p3-evidence.json"
```

CI fake-provider command (the CI path uses its own disposable target):

```bash
node "$TOOLS/run-fake-scenario.mjs" --step 14 --target "$FAKE_TARGET" --state "$FAKE_STATE"
```

Observable: the dump contains the stored bundle hash/content, certifications, and Concertmaster report; the bundle ID matches the report and reconstructs decisions, effects, cost, dissent, recovery, limitations, and pending approval.

## Stop conditions

Stop and mark the gate failed if any mixed-risk block partially executes, a model runs below requirement without approval, certification lacks routing/evidence lineage, restart duplicates or loses work, remote push is invoked, a forbidden effect executes, or the evidence bundle/report IDs differ.
