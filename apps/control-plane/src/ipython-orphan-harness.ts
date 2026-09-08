import { createControlPlane } from "./main.js";
import { parseConfig } from "./config.js";
import type { IpPythonSessionBinding, IpPythonSessionManager } from "@maestro/agent-runtime";

const mode = process.env.IPYTHON_HARNESS_MODE;
const sessionId = process.env.IPYTHON_HARNESS_SESSION_ID;
const projectId = process.env.IPYTHON_HARNESS_PROJECT_ID;
const goalId = process.env.IPYTHON_HARNESS_GOAL_ID;
if ((mode !== "start" && mode !== "restart") || !sessionId || !projectId || !goalId) throw new Error("invalid IPython harness configuration");
const requiredSessionId = sessionId;
const requiredProjectId = projectId;
const requiredGoalId = goalId;

let sessions: IpPythonSessionManager | undefined;
const controlPlane = createControlPlane(parseConfig(process.env), {
  onIpPythonSessionManager: (manager) => { sessions = manager; },
});

async function waitForStartedJournal(): Promise<{ processRef: string; processPid: number }> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await controlPlane.pool.query<{ process_ref: string; process_pid: number }>(
      "SELECT process_ref, process_pid FROM ipython_session_journal WHERE session_id = $1 AND event = 'started' ORDER BY journal_position DESC LIMIT 1",
      [requiredSessionId],
    );
    const row = result.rows[0];
    if (row !== undefined) return { processRef: row.process_ref, processPid: row.process_pid };
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timed out waiting for durable IPython start evidence");
}

async function main(): Promise<void> {
  await controlPlane.listen();
  if (mode === "restart") {
    process.stdout.write(JSON.stringify({ type: "ready" }) + "\n");
  } else {
    if (sessions === undefined) throw new Error("IPython session manager was not composed");
    const binding: IpPythonSessionBinding = {
      sessionId: requiredSessionId,
      commandId: `harness-command-${requiredSessionId}`,
      toolCallId: `harness-tool-${requiredSessionId}`,
      operatorId: "harness-operator",
      projectId: requiredProjectId,
      goalId: requiredGoalId,
      pathScope: [process.cwd()],
      outboundDataClasses: ["workspace"],
      authorityPolicyVersion: 0,
      controlEpoch: "harness-control-epoch",
      budgetEffectCents: 0,
    };
    void sessions.execute({ sessionId: requiredSessionId, code: "print('orphan-journal-harness')", binding }).catch(() => undefined);
    const started = await waitForStartedJournal();
    process.stdout.write(JSON.stringify({ type: "started", ...started }) + "\n");
  }
  // Keep the control plane alive until the integration test injects SIGKILL.
  setInterval(() => {}, 60_000);
}

void main().catch(async (error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  await controlPlane.close().catch(() => undefined);
  process.exitCode = 1;
});
