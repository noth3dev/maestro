# Phase 3 first-usable-release runbook

This is the one-scenario operator runbook for Plan 3 S4. It uses one disposable target under `MAESTRO_WORKTREE_ROOT`; never reuse or edit `testbed/`. The committed fake-provider test exercises the same fixture mechanics in CI. **Do not run live provider acceptance in CI or from fixture tests.** The live provider run is the user's handoff after S4 merges.

## Prepare once

Set `PROJECT_ID` to the existing project that has Control Plane access. Set `MAESTRO_MODEL` to an allowed model. The restart command assumes the built Control Plane can start with the repository's configured environment.

```bash
cd /home/ubuntu/projects/ms
export MAESTRO_WORKTREE_ROOT="${MAESTRO_WORKTREE_ROOT:?Set an existing disposable parent directory}"
test -d "$MAESTRO_WORKTREE_ROOT"
export MAESTRO_API_TOKEN="${MAESTRO_API_TOKEN:?Set an API token}"
export PROJECT_ID="${PROJECT_ID:?Set the project UUID}"
export MAESTRO_MODEL="${MAESTRO_MODEL:?Set an allowed model reference}"
export MAESTRO_NATIVE_MODEL="${MAESTRO_NATIVE_MODEL:?Set the configured native model reference}"
export MAESTRO_PORT="${MAESTRO_PORT:-4310}"
export MAESTRO_API_URL="http://127.0.0.1:$MAESTRO_PORT"
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
( cd apps/control-plane && MAESTRO_PORT="$MAESTRO_PORT" node dist/main.js ) > "$SCENARIO_DIR/control-plane.log" 2>&1 &
export CONTROL_PLANE_PID=$!
export CONTROL_PLANE_URL="$MAESTRO_API_URL"
until curl -fsS "$CONTROL_PLANE_URL/readyz" >/dev/null; do kill -0 "$CONTROL_PLANE_PID" 2>/dev/null || { cat "$SCENARIO_DIR/control-plane.log"; exit 1; }; done
export FAKE_STATE="$SCENARIO_DIR/fake-state.json"
```

The initial target test is expected to fail because the target contains the seeded defect:

```bash
npm test --prefix "$TARGET"; test $? -ne 0
```

Keep the same `TARGET`, Goal, Control Plane process, and provider session for every step. Save every JSON output in `SCENARIO_DIR`.

## Step 1 — CEO request and contract intake

Create the Task Contract first so the Goal is durably bound to the launched scenario contract. Keep the same identifiers for every later step:

```bash
node "$TOOLS/write-input.mjs" --kind contract --project "$PROJECT_ID" --repository "$TARGET" --base "$BASE_REVISION" --out "$SCENARIO_DIR/contract-substance.json"
export CONTRACT_ID="$(uuid)"
$MAESTRO task-contract create --project-id "$PROJECT_ID" --contract-id "$CONTRACT_ID" --substance-json "$(cat "$SCENARIO_DIR/contract-substance.json")" --json > "$SCENARIO_DIR/contract.json"
```

CI fake-provider command (the CI path uses its own disposable target):

```bash
node "$TOOLS/run-fake-scenario.mjs" --step 1 --target "$FAKE_TARGET" --state "$FAKE_STATE"
```

Observable: the draft contract records the disposable target and immutable base revision; no Goal, worker, or effect exists yet.

## Step 2 — Contract readback

Read back the exact contract created in Step 1:

```bash
$MAESTRO task-contract get --project-id "$PROJECT_ID" --contract-id "$CONTRACT_ID" --json > "$SCENARIO_DIR/contract-read.json"
```

CI fake-provider command (the CI path uses its own disposable target):

```bash
node "$TOOLS/run-fake-scenario.mjs" --step 2 --target "$FAKE_TARGET" --state "$FAKE_STATE"
```

Observable: the contract binds `$TARGET`, the immutable base revision, desired outcome, scope, non-goals, and test evidence; it remains in the exact state required for Step 3 confirmation.

## Step 3 — Exact launch confirmation

Command:

```bash
export CONTRACT_VERSION="$(json_value "$SCENARIO_DIR/contract.json" version)"
export CONTRACT_HASH="$(json_value "$SCENARIO_DIR/contract.json" contentHash)"
$MAESTRO task-contract confirm --project-id "$PROJECT_ID" --contract-id "$CONTRACT_ID" --version "$CONTRACT_VERSION" --content-hash "$CONTRACT_HASH" --command-id "$(uuid)" --json > "$SCENARIO_DIR/confirmation.json"
$MAESTRO task-contract launch --project-id "$PROJECT_ID" --contract-id "$CONTRACT_ID" --command-id "$(uuid)" --json > "$SCENARIO_DIR/launch.json"
export COMMAND_ID="$(uuid)"
$MAESTRO goal create --project-id "$PROJECT_ID" --contract-id "$CONTRACT_ID" --command-id "$COMMAND_ID" --json > "$SCENARIO_DIR/goal.json"
export GOAL_ID="$(json_value "$SCENARIO_DIR/goal.json" goalId)"
$MAESTRO goal transition --goal-id "$GOAL_ID" --project-id "$PROJECT_ID" --expected-version 1 --to ready_for_confirmation --command-id "$(uuid)" --json > "$SCENARIO_DIR/goal-ready-for-confirmation.json"
$MAESTRO goal transition --goal-id "$GOAL_ID" --project-id "$PROJECT_ID" --expected-version 2 --to launched --command-id "$(uuid)" --json > "$SCENARIO_DIR/goal-launched.json"
$MAESTRO goal transition --goal-id "$GOAL_ID" --project-id "$PROJECT_ID" --expected-version 3 --to active --command-id "$(uuid)" --json > "$SCENARIO_DIR/goal-active.json"
$MAESTRO conversation create --project-id "$PROJECT_ID" --goal-id "$GOAL_ID" --model "$MAESTRO_MODEL" --json > "$SCENARIO_DIR/conversation.json"
export CONVERSATION_ID="$(json_value "$SCENARIO_DIR/conversation.json" conversationId)"
$MAESTRO conversation turn --conversation-id "$CONVERSATION_ID" --project-id "$PROJECT_ID" --text "Repair the discount calculation in $TARGET; do not push remotely." --json > "$SCENARIO_DIR/ceo-request.json"
printf 'Goal=%s\nTarget=%s\nBase=%s\n' "$GOAL_ID" "$TARGET" "$BASE_REVISION" > "$SCENARIO_DIR/scenario-evidence-anchor.txt"
$MAESTRO evidence capture --goal-id "$GOAL_ID" --project-id "$PROJECT_ID" --correlation-id "$(uuid)" --command-id "$(uuid)" --kind release-scenario-anchor --media-type text/plain --content-file "$SCENARIO_DIR/scenario-evidence-anchor.txt" --json > "$SCENARIO_DIR/scenario-evidence.json"
export SCENARIO_EVIDENCE_ID="$(json_value "$SCENARIO_DIR/scenario-evidence.json" evidenceId)"
```

CI fake-provider command (the CI path uses its own disposable target):

```bash
node "$TOOLS/run-fake-scenario.mjs" --step 3 --target "$FAKE_TARGET" --state "$FAKE_STATE"
```

Observable: confirmation is durable before launch; a changed `contentHash` makes the command fail; the launched contract is then bound to the newly created Goal and CEO conversation.

## Step 4 — Necessary Heads only

Command:

```bash
node "$TOOLS/write-input.mjs" --kind head --project "$PROJECT_ID" --contract "$CONTRACT_ID" --department engineering --out "$SCENARIO_DIR/engineering-head.json"
$MAESTRO head activate --goal-id "$GOAL_ID" --activation-json "$(cat "$SCENARIO_DIR/engineering-head.json")" --command-id "$(uuid)" --json > "$SCENARIO_DIR/engineering-head.json.out"
node "$TOOLS/write-input.mjs" --kind head --project "$PROJECT_ID" --contract "$CONTRACT_ID" --department quality --out "$SCENARIO_DIR/quality-head.json"
$MAESTRO head activate --goal-id "$GOAL_ID" --activation-json "$(cat "$SCENARIO_DIR/quality-head.json")" --command-id "$(uuid)" --json > "$SCENARIO_DIR/quality-head.json.out"
```

CI fake-provider command (the CI path uses its own disposable target):

```bash
node "$TOOLS/run-fake-scenario.mjs" --step 4 --target "$FAKE_TARGET" --state "$FAKE_STATE"
```

Observable: the contract-bound `engineering` and `quality` Heads are active; no unnecessary Head is activated. Step 5 must record one Department Plan for each of them.

## Step 5 — Department Plans

Create the exact contract-derived inputs, then run each Council boundary explicitly:

```bash
node "$TOOLS/write-input.mjs" --kind council --project "$PROJECT_ID" --contract "$CONTRACT_ID" --evidence-id "$SCENARIO_EVIDENCE_ID" --out "$SCENARIO_DIR/council.json"
node "$TOOLS/write-input.mjs" --kind brief --project "$PROJECT_ID" --department engineering --out "$SCENARIO_DIR/engineering-brief.json"
node "$TOOLS/write-input.mjs" --kind brief --project "$PROJECT_ID" --department quality --out "$SCENARIO_DIR/quality-brief.json"
node "$TOOLS/write-input.mjs" --kind packet --project "$PROJECT_ID" --evidence-id "$SCENARIO_EVIDENCE_ID" --out "$SCENARIO_DIR/decision-packet.json"
node "$TOOLS/write-input.mjs" --kind plan --project "$PROJECT_ID" --department engineering --evidence-id "$SCENARIO_EVIDENCE_ID" --target "$TARGET" --item discount-repair --out "$SCENARIO_DIR/engineering-department-plan.json"
node "$TOOLS/write-input.mjs" --kind plan --project "$PROJECT_ID" --department quality --evidence-id "$SCENARIO_EVIDENCE_ID" --target "$TARGET" --item discount-validation --out "$SCENARIO_DIR/quality-department-plan.json"
node "$TOOLS/write-input.mjs" --kind mission --project "$PROJECT_ID" --evidence-id "$SCENARIO_EVIDENCE_ID" --contract "$CONTRACT_ID" --target "$TARGET" --out "$SCENARIO_DIR/mission-bundle.json"
$MAESTRO git goal-branch --goal-id "$GOAL_ID" --project-id "$PROJECT_ID" --repository-path "$TARGET" --branch-name goal/integration --base-revision "$BASE_REVISION" --command-id "$(uuid)" --json > "$SCENARIO_DIR/goal-branch.json"
$MAESTRO council create --goal-id "$GOAL_ID" --council-json "$(cat "$SCENARIO_DIR/council.json")" --command-id "$(uuid)" --json > "$SCENARIO_DIR/council-created.json"
export COUNCIL_ID="$(json_value "$SCENARIO_DIR/council-created.json" councilId)"
$MAESTRO council submit-brief --council-id "$COUNCIL_ID" --department-id engineering --brief-json "$(cat "$SCENARIO_DIR/engineering-brief.json")" --command-id "$(uuid)" --json > "$SCENARIO_DIR/engineering-brief-submitted.json"
$MAESTRO council submit-brief --council-id "$COUNCIL_ID" --department-id quality --brief-json "$(cat "$SCENARIO_DIR/quality-brief.json")" --command-id "$(uuid)" --json > "$SCENARIO_DIR/quality-brief-submitted.json"
$MAESTRO council reveal --council-id "$COUNCIL_ID" --project-id "$PROJECT_ID" --command-id "$(uuid)" --json > "$SCENARIO_DIR/council-revealed.json"
$MAESTRO council decide --council-id "$COUNCIL_ID" --packet-json "$(cat "$SCENARIO_DIR/decision-packet.json")" --command-id "$(uuid)" --json > "$SCENARIO_DIR/council-decision.json"
$MAESTRO git department-branch --council-id "$COUNCIL_ID" --department-id engineering --project-id "$PROJECT_ID" --command-id "$(uuid)" --json > "$SCENARIO_DIR/engineering-department-branch.json"
$MAESTRO git department-branch --council-id "$COUNCIL_ID" --department-id quality --project-id "$PROJECT_ID" --command-id "$(uuid)" --json > "$SCENARIO_DIR/quality-department-branch.json"
$MAESTRO department-plan create --council-id "$COUNCIL_ID" --department-id engineering --plan-json "$(cat "$SCENARIO_DIR/engineering-department-plan.json")" --command-id "$(uuid)" --json > "$SCENARIO_DIR/engineering-department-plan.json.out"
$MAESTRO department-plan create --council-id "$COUNCIL_ID" --department-id quality --plan-json "$(cat "$SCENARIO_DIR/quality-department-plan.json")" --command-id "$(uuid)" --json > "$SCENARIO_DIR/quality-department-plan.json.out"
export ITEM_ID="discount-repair"
$MAESTRO mission-bundle create --council-id "$COUNCIL_ID" --department-id engineering --item-id "$ITEM_ID" --bundle-json "$(cat "$SCENARIO_DIR/mission-bundle.json")" --command-id "$(uuid)" --json > "$SCENARIO_DIR/mission-bundle.json.out"
$MAESTRO mission-bundle get --council-id "$COUNCIL_ID" --department-id engineering --plan-version 1 --item-id "$ITEM_ID" --project-id "$PROJECT_ID" --json > "$SCENARIO_DIR/mission-bundle-read.json"
node -e 'const fs=require("node:fs"); const x=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); const hold=x.substance?.repairHold; if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(hold?.approvalId ?? "") || hold?.repetitionScope?.kind !== "bounded_count" || hold?.repetitionScope?.count !== 1) throw new Error("Mission Bundle repair hold is not valid or durable");' "$SCENARIO_DIR/mission-bundle-read.json"
```

CI fake-provider command (the CI path uses its own disposable target):

```bash
node "$TOOLS/run-fake-scenario.mjs" --step 5 --target "$FAKE_TARGET" --state "$FAKE_STATE"
```

Observable: both active Heads have a durably recorded Department Plan. The Council packet, Department Plans, and Mission Bundle all bind to the same Goal, contract version/content hash, and target path.

## Step 6 — Native disposable-project execution

Command:

```bash
export WORKER_WORKTREE="$MAESTRO_WORKTREE_ROOT/worker-$(uuid)"
node "$TOOLS/write-input.mjs" --kind worker --project "$PROJECT_ID" --item "$ITEM_ID" --repository "$TARGET" --worktree "$WORKER_WORKTREE" --out "$SCENARIO_DIR/worker.json"
$MAESTRO worker spawn --council-id "$COUNCIL_ID" --department-id engineering --worker-json "$(cat "$SCENARIO_DIR/worker.json")" --command-id "$(uuid)" --json > "$SCENARIO_DIR/worker.json.out"
export WORKER_ID="$(json_value "$SCENARIO_DIR/worker.json.out" workerId)"
$MAESTRO worker observe --worker-id "$WORKER_ID" --project-id "$PROJECT_ID" --command-id "$(uuid)" --json > "$SCENARIO_DIR/worker-observation.json"
export ORIGINAL_EXECUTION_REF="$(json_value "$SCENARIO_DIR/worker-observation.json" executionRef)"
export ORIGINAL_INVOCATION_REF="$(json_value "$SCENARIO_DIR/worker-observation.json" invocationRef)"
$MAESTRO workers list --goal-id "$GOAL_ID" --project-id "$PROJECT_ID" --json > "$SCENARIO_DIR/workers-after-execution.json"
```

CI fake-provider command (the CI path uses its own disposable target):

```bash
node "$TOOLS/run-fake-scenario.mjs" --step 6 --target "$FAKE_TARGET" --state "$FAKE_STATE"
```

Observable: the worker reads/writes only `$WORKER_WORKTREE`, which was prepared from `$TARGET`; the repository root, original `$TARGET` checkout, and remote are untouched.

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
node "$WORKER_WORKTREE/scripts/inject-unsupported-assertion.mjs"
set +e; npm test --prefix "$WORKER_WORKTREE" > "$SCENARIO_DIR/unsupported-test.log" 2>&1; export UNSUPPORTED_EXIT=$?; set -e
node "$WORKER_WORKTREE/scripts/clear-unsupported-assertion.mjs"
node "$TOOLS/write-input.mjs" --kind review --project "$PROJECT_ID" --evidence-id "$SCENARIO_EVIDENCE_ID" --out "$SCENARIO_DIR/unsupported-review.json"
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
$MAESTRO worker observe --worker-id "$WORKER_ID" --project-id "$PROJECT_ID" --command-id "$(uuid)" --json > "$SCENARIO_DIR/worker-before-quality.json"
case "$(json_value "$SCENARIO_DIR/worker-before-quality.json" status)" in spawned|running|awaiting_repair) ;; *) echo "worker is not messageable" >&2; exit 1;; esac
set +e; npm test --prefix "$WORKER_WORKTREE" > "$SCENARIO_DIR/seeded-defect.log" 2>&1; export DEFECT_EXIT=$?; set -e
authority=$(uuid)
$MAESTRO evidence capture --goal-id "$GOAL_ID" --project-id "$PROJECT_ID" --correlation-id "$authority" --command-id "$(uuid)" --kind target-test-failure --media-type text/plain --content-file "$SCENARIO_DIR/seeded-defect.log" --json > "$SCENARIO_DIR/target-test-failure.json"
export TEST_FAILURE_EVIDENCE_ID="$(json_value "$SCENARIO_DIR/target-test-failure.json" evidenceId)"
node "$TOOLS/write-input.mjs" --kind certification --project "$PROJECT_ID" --evidence-id "$TEST_FAILURE_EVIDENCE_ID" --verdict failed --out "$SCENARIO_DIR/failed-quality-certification.json"
set +e; $MAESTRO worker certify --worker-id "$WORKER_ID" --certification-json "$(cat "$SCENARIO_DIR/failed-quality-certification.json")" --project-id "$PROJECT_ID" --command-id "$(uuid)" --json > "$SCENARIO_DIR/failed-certification.out" 2>&1; export CERTIFICATION_EXIT=$?; set -e
test "$CERTIFICATION_EXIT" -ne 0
test "$DEFECT_EXIT" -ne 0
```

CI fake-provider command (the CI path uses its own disposable target):

```bash
node "$TOOLS/run-fake-scenario.mjs" --step 9 --target "$FAKE_TARGET" --state "$FAKE_STATE"
```

Observable: the seeded defect test fails and the pre-repair certification request is rejected because the worker has no accepted integration lineage; the final report cannot claim success. The worker must still be `running` for Step 10 repair messaging.

## Step 10 — Repair and recertify

Commands:

```bash
$MAESTRO worker observe --worker-id "$WORKER_ID" --project-id "$PROJECT_ID" --command-id "$(uuid)" --json > "$SCENARIO_DIR/worker-before-repair.json"
case "$(json_value "$SCENARIO_DIR/worker-before-repair.json" status)" in spawned|running|awaiting_repair) ;; *) echo "worker is not messageable" >&2; exit 1;; esac
$MAESTRO worker message --worker-id "$WORKER_ID" --project-id "$PROJECT_ID" --message "Quality found the seeded defect. Repair the bound target, run its test, and do not push remotely." --command-id "$(uuid)" --json > "$SCENARIO_DIR/worker-repair-message.json"
test "$(json_value "$SCENARIO_DIR/worker-repair-message.json" status)" = "running"
test "$(json_value "$SCENARIO_DIR/worker-repair-message.json" executionRef)" = "$ORIGINAL_EXECUTION_REF"
test "$(json_value "$SCENARIO_DIR/worker-repair-message.json" invocationRef)" = "$ORIGINAL_INVOCATION_REF"
$MAESTRO conversation turn --conversation-id "$CONVERSATION_ID" --project-id "$PROJECT_ID" --text "Quality found the seeded defect. Repair only $WORKER_WORKTREE now, run its test, and do not push remotely." --json > "$SCENARIO_DIR/repair-request.json"
$MAESTRO worker observe --worker-id "$WORKER_ID" --project-id "$PROJECT_ID" --command-id "$(uuid)" --json > "$SCENARIO_DIR/worker-after-repair.json"
npm test --prefix "$WORKER_WORKTREE" > "$SCENARIO_DIR/passing-test.log" 2>&1
$MAESTRO evidence capture --goal-id "$GOAL_ID" --project-id "$PROJECT_ID" --correlation-id "$(uuid)" --command-id "$(uuid)" --kind target-test-passed --media-type text/plain --content-file "$SCENARIO_DIR/passing-test.log" --json > "$SCENARIO_DIR/target-test-passed.json"
export TEST_PASS_EVIDENCE_ID="$(json_value "$SCENARIO_DIR/target-test-passed.json" evidenceId)"
$MAESTRO git worker-advance --worker-id "$WORKER_ID" --project-id "$PROJECT_ID" --message "Integrate the certified disposable-target repair" --evidence-references "[\"$SCENARIO_EVIDENCE_ID\",\"$TEST_PASS_EVIDENCE_ID\"]" --command-id "$(uuid)" --json > "$SCENARIO_DIR/worker-integration.json"
$MAESTRO worker accept --worker-id "$WORKER_ID" --project-id "$PROJECT_ID" --reason "Native repair and test evidence observed" --command-id "$(uuid)" --json > "$SCENARIO_DIR/worker-accepted.json"
$MAESTRO git goal-revision --goal-id "$GOAL_ID" --project-id "$PROJECT_ID" --command-id "$(uuid)" --json > "$SCENARIO_DIR/integration-revision.json"
$MAESTRO git status --goal-id "$GOAL_ID" --project-id "$PROJECT_ID" --json > "$SCENARIO_DIR/git-status.json"
export INTEGRATED_REVISION="$(json_value "$SCENARIO_DIR/integration-revision.json" commitSha)"
node "$TOOLS/write-input.mjs" --kind certification --project "$PROJECT_ID" --verdict passed --evidence-id "$TEST_PASS_EVIDENCE_ID" --out "$SCENARIO_DIR/passing-quality-certification.json"
$MAESTRO worker certify --worker-id "$WORKER_ID" --certification-json "$(cat "$SCENARIO_DIR/passing-quality-certification.json")" --project-id "$PROJECT_ID" --command-id "$(uuid)" --json > "$SCENARIO_DIR/passing-certification.json"
```

CI fake-provider command (the CI path uses its own disposable target):

```bash
node "$TOOLS/run-fake-scenario.mjs" --step 10 --target "$FAKE_TARGET" --state "$FAKE_STATE"
```

Observable: the target test passes, `$INTEGRATED_REVISION` is the revision Quality certifies, and no critical blocker remains.

## Step 11 — Forced restart

Kill the Control Plane with a hard SIGKILL while a worker spawn is in flight -- the same failure mode the real production reconciler must recover from, not a graceful shutdown. Note the in-flight worker's ID before killing, then restart against the same database and confirm the worker is fenced exactly once:

```bash
export ORIGINAL_WORKER_ID="$WORKER_ID"
kill -KILL "$CONTROL_PLANE_PID"
for _ in $(seq 1 100); do kill -0 "$CONTROL_PLANE_PID" 2>/dev/null || break; sleep 0.05; done
if kill -0 "$CONTROL_PLANE_PID" 2>/dev/null; then echo "old Control Plane did not exit" >&2; exit 1; fi
( cd /home/ubuntu/projects/ms/apps/control-plane && node dist/main.js ) > "$SCENARIO_DIR/control-plane-restart.log" 2>&1 &
export CONTROL_PLANE_PID=$!
until curl -fsS "$CONTROL_PLANE_URL/readyz" >/dev/null; do kill -0 "$CONTROL_PLANE_PID" 2>/dev/null || { cat "$SCENARIO_DIR/control-plane-restart.log"; exit 1; }; done
ps -p "$CONTROL_PLANE_PID" -o pid= | grep -q "$CONTROL_PLANE_PID"
$MAESTRO goal get --goal-id "$GOAL_ID" --project-id "$PROJECT_ID" --json > "$SCENARIO_DIR/goal-after-restart.json"
$MAESTRO worker observe --worker-id "$ORIGINAL_WORKER_ID" --project-id "$PROJECT_ID" --command-id "$(uuid)" --json > "$SCENARIO_DIR/worker-after-restart.json"
```

CI fake-provider command (the CI path uses its own disposable target):

```bash
node "$TOOLS/run-fake-scenario.mjs" --step 11 --target "$FAKE_TARGET" --state "$FAKE_STATE"
```

Observable: this is the same real production recovery mechanism proven end-to-end by
`test/release-scenario/worker-restart-recovery.integration.test.ts`, which spawns a real
Control Plane process and a real provider process over TCP, issues a real HTTP worker-spawn
request, SIGKILLs the Control Plane after the provider has been invoked but before the
response is durably bound, restarts a second real Control Plane process against the same
database, and asserts recovery is exactly-once: one `worker_recovery_decisions` row for the
worker, one provider spawn (no duplicate invocation), the worker fenced to the new
reconciler owner, and a `409 council_conflict` on any retry of the same council/plan/item
(no stale authority reuse). In the live run, confirm the same shape: `worker-after-restart.json`
reports `status:"unknown"` with `recoveryState:"fenced"`, the original `executionRef`/`invocationRef`
are preserved (not regenerated), and a second worker-spawn attempt for the same item is rejected
rather than silently duplicating the provider invocation. The fake-provider CI command above
exercises the equivalent in-memory checkpoint/resume path for the disposable CI target and must
report `boundary:"mid-execution"`, `resumed:true`, and `duplicateWrites:0`.

## Step 12 — Ambiguous action and remote push

Commands:

```bash
cat "$WORKER_WORKTREE/fixtures/ambiguous-action.json"
set +e; $MAESTRO critical-action request --goal-id "$GOAL_ID" --project-id "$PROJECT_ID" --action git.remote.push --target origin/main --version 1 --budget-effect-cents 0 --command-id "$(uuid)" --json > "$SCENARIO_DIR/ambiguous-action.json.out" 2>&1; export REQUEST_EXIT=$?; set -e
test "$REQUEST_EXIT" -ne 0
set +e; $MAESTRO critical-action approve-and-run --goal-id "$GOAL_ID" --project-id "$PROJECT_ID" --action git.remote.push --target origin/main --version 1 --budget-effect-cents 0 --expires-at "$(date -u -d '+5 minutes' +%Y-%m-%dT%H:%M:%SZ)" --command-id "$(uuid)" --json > "$SCENARIO_DIR/remote-approval.out"; export REMOTE_APPROVAL_EXIT=$?; set -e
test "$REMOTE_APPROVAL_EXIT" -ne 0
test "$(json_value "$SCENARIO_DIR/ambiguous-action.json.out" status)" != "allowed"
```

CI fake-provider command (the CI path uses its own disposable target):

```bash
node "$TOOLS/run-fake-scenario.mjs" --step 12 --target "$FAKE_TARGET" --state "$FAKE_STATE"
```

Observable: the authenticated Control Plane critical-action gateway records the escalation and invokes the provider boundary in fail-closed mode: `attempted:true`, `status:"blocked"`, and `networkInvoked:false`; no remote invocation occurs.

## Step 13 — Full-access modes and forbidden effects

Select each production capability mode through the authenticated Goal-scoped CLI route. Each mode uses a fresh immutable capability session for the same Goal; no environment variable stands in for the persisted selection. The provider boundary consumes each selected Goal-scoped capability session. A mode-specific remote attempt is therefore valid only when its result comes from the authenticated Control Plane/provider execution path.

```bash
export RETAIN_SESSION_ID="$(uuid)"
$MAESTRO capability select-full-access-mode --goal-id "$GOAL_ID" --project-id "$PROJECT_ID" --capability-kind ipython --session-id "$RETAIN_SESSION_ID" --full-access-mode retain_intermediate_approvals --json > "$SCENARIO_DIR/full-access-retain.json"
export SKIP_SESSION_ID="$(uuid)"
$MAESTRO capability select-full-access-mode --goal-id "$GOAL_ID" --project-id "$PROJECT_ID" --capability-kind ipython --session-id "$SKIP_SESSION_ID" --full-access-mode skip_intermediate_approvals --json > "$SCENARIO_DIR/full-access-skip.json"
node -e 'const fs=require("node:fs"); for (const file of process.argv.slice(1)) { const x=JSON.parse(fs.readFileSync(file,"utf8")); if (!["retain_intermediate_approvals","skip_intermediate_approvals"].includes(x.fullAccessMode)) throw new Error("unexpected capability mode"); }' "$SCENARIO_DIR/full-access-retain.json" "$SCENARIO_DIR/full-access-skip.json"
set +e; $MAESTRO critical-action approve-and-run --goal-id "$GOAL_ID" --project-id "$PROJECT_ID" --action git.remote.push --target origin/main --version 1 --budget-effect-cents 0 --expires-at "$(date -u -d '+5 minutes' +%Y-%m-%dT%H:%M:%SZ)" --command-id "$(uuid)" --json > "$SCENARIO_DIR/retain-mode-remote.out" 2>&1; export RETAIN_REMOTE_EXIT=$?; set -e
test "$RETAIN_REMOTE_EXIT" -ne 0
set +e; $MAESTRO critical-action approve-and-run --goal-id "$GOAL_ID" --project-id "$PROJECT_ID" --action git.remote.push --target origin/main --version 1 --budget-effect-cents 0 --expires-at "$(date -u -d '+5 minutes' +%Y-%m-%dT%H:%M:%SZ)" --command-id "$(uuid)" --json > "$SCENARIO_DIR/skip-mode-remote.out" 2>&1; export SKIP_REMOTE_EXIT=$?; set -e
test "$SKIP_REMOTE_EXIT" -ne 0
```

CI fake-provider command (the CI path uses its own disposable target):

```bash
node "$TOOLS/run-fake-scenario.mjs" --step 13 --target "$FAKE_TARGET" --state "$FAKE_STATE"
```

Observable: both canonical modes are durably selected for the Goal, and the authenticated Control Plane/provider path blocks the forbidden effect for each selected session without invoking the network. The evidence is provider/control-plane evidence, not a standalone fixture claim.

## Step 14 — Final report and evidence dump

Command:

```bash
$MAESTRO concertmaster-report generate --project-id "$PROJECT_ID" --goal-id "$GOAL_ID" --command-id "$(uuid)" --json > "$SCENARIO_DIR/concertmaster-report-generated.json"
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
