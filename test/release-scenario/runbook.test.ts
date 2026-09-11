import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("release scenario runbook", () => {
  it("enumerates all fourteen live steps and their observables", async () => {
    const runbook = await readFile(new URL("./RUNBOOK.md", import.meta.url), "utf8");
    const checklist = await readFile(new URL("./CHECKLIST.md", import.meta.url), "utf8");
    for (let step = 1; step <= 14; step += 1) {
      expect(runbook).toContain(`## Step ${step}`);
      expect(checklist).toContain(`- [ ] ${step}.`);
      expect(runbook).toContain(`run-fake-scenario.mjs" --step ${step}`);
      expect(runbook).toContain(`Observable:`);
    }
    expect(runbook).toContain("evidence dump");
    expect(runbook).toContain("Do not run live provider acceptance");
    expect(runbook).toContain("goal create --project-id \"$PROJECT_ID\" --contract-id \"$CONTRACT_ID\"");
    expect(runbook).toContain('goal transition --goal-id "$GOAL_ID" --project-id "$PROJECT_ID" --expected-version 1 --to ready_for_confirmation');
    expect(runbook).toContain('goal transition --goal-id "$GOAL_ID" --project-id "$PROJECT_ID" --expected-version 2 --to launched');
    expect(runbook).toContain('goal transition --goal-id "$GOAL_ID" --project-id "$PROJECT_ID" --expected-version 3 --to active');
    expect(runbook).toContain('department-id quality --brief-json');
    expect(runbook).toContain('concertmaster-report generate');
    expect(runbook).not.toContain("certification.out || true");
    expect(runbook).toContain('export MAESTRO_API_URL="http://127.0.0.1:$MAESTRO_PORT"');
    expect(runbook).not.toContain("attempt-remote-push.mjs");
    expect(runbook).toContain("git goal-branch");
    expect(runbook).toContain("git department-branch");
    const inputWriter = await readFile(new URL("./write-input.mjs", import.meta.url), "utf8");
    expect(inputWriter).toContain("repairHold");
    expect(inputWriter).toContain("contractId: parsed.values.contract");
    expect(inputWriter).toContain('"evidence-id"');
    expect(inputWriter).toContain('dataBoundary: ["target only"]');
    expect(inputWriter).toContain('timeCeiling: "5 minutes"');
    expect(inputWriter).toContain("workerCeiling: 0");
    expect(inputWriter).toContain('certifyingDepartmentId: "quality"');
    expect(inputWriter).not.toContain('testEvidenceIds: ["target-test"]');
    expect(inputWriter).not.toContain("release-scenario-runbook");
    expect(inputWriter).toContain("repairHold");
    const apiClient = await readFile(new URL("../../packages/api-client/src/index.ts", import.meta.url), "utf8");
    expect(apiClient).toContain("generateConcertmasterReport");
  });

  it("uses the S6b target-bound worker and real approval surfaces", async () => {
    const runbook = await readFile(new URL("./RUNBOOK.md", import.meta.url), "utf8");
    expect(runbook).toContain('export MAESTRO_API_TOKEN="${MAESTRO_API_TOKEN:?Set an API token}"');
    expect(runbook).toContain('--repository "$TARGET"');
    expect(runbook).toContain('--worktree "$WORKER_WORKTREE"');
    expect(runbook).not.toContain('git worker-worktree --worker-id "$WORKER_ID"');
    expect(runbook).toContain('$MAESTRO worker message --worker-id "$WORKER_ID"');
    expect(runbook).toContain('test "$(json_value "$SCENARIO_DIR/worker-repair-message.json" status)" = "running"');
    expect(runbook).toContain('test "$(json_value "$SCENARIO_DIR/worker-repair-message.json" executionRef)" = "$ORIGINAL_EXECUTION_REF"');
    expect(runbook).toContain('test "$(json_value "$SCENARIO_DIR/worker-repair-message.json" invocationRef)" = "$ORIGINAL_INVOCATION_REF"');
    expect(runbook).toContain("spawned|running|awaiting_repair");
    expect(runbook).toContain('boundary:"mid-execution"');
    expect(runbook).toContain('resumed:true');
    expect(runbook).toContain('department-id quality --plan-json');
    expect(runbook).toContain('set +e; $MAESTRO critical-action request');
    expect(runbook).toContain('$MAESTRO git worker-advance --worker-id "$WORKER_ID"');
    expect(runbook).not.toContain('SCENARIO_EVIDENCE_ID="${SCENARIO_EVIDENCE_ID:?');
    expect(runbook).toContain('$MAESTRO evidence capture');
    expect(runbook).toContain('target-test-failure');
    expect(runbook).toContain('target-test-passed');
    expect(runbook).toContain('TEST_FAILURE_EVIDENCE_ID');
    expect(runbook).toContain('TEST_PASS_EVIDENCE_ID');
    expect(runbook).toContain('$MAESTRO capability select-full-access-mode');
    expect(runbook).toContain("provider boundary consumes each selected Goal-scoped capability session");
    expect(runbook).toContain('retain-mode-remote.out');
    expect(runbook).toContain('skip-mode-remote.out');
    expect(runbook).not.toContain("fixture-only");
    expect(runbook).not.toContain("attempt-remote-push.mjs");
    expect(runbook.indexOf("git worker-advance")).toBeLessThan(runbook.indexOf("worker accept"));
    expect(runbook).toContain("retain_intermediate_approvals");
    expect(runbook).toContain("skip_intermediate_approvals");
    expect(runbook).not.toContain("public Control Plane/CLI surface does not expose");
    expect(runbook).not.toContain("MAESTRO_ACCESS_MODE");
    expect(runbook).not.toContain("full-access-read");
    expect(runbook).not.toContain("full-access-write");
  });

  it("keeps the fake provider's capability mode names aligned with production", async () => {
    const fakeProvider = await readFile(new URL("./fake-provider-process.mjs", import.meta.url), "utf8");
    const fakeControlPlane = await readFile(new URL("./fake-control-plane-process.mjs", import.meta.url), "utf8");
    expect(fakeProvider).toContain("retain_intermediate_approvals");
    expect(fakeProvider).toContain("skip_intermediate_approvals");
    expect(fakeControlPlane).toContain("retain_intermediate_approvals");
    expect(fakeControlPlane).toContain("skip_intermediate_approvals");
    expect(fakeProvider).not.toContain("full-access-read");
    expect(fakeControlPlane).not.toContain("full-access-write");
  });
});
