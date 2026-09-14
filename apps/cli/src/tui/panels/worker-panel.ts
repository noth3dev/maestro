import type { Worker, WorkerObservation } from "@maestro/contracts";
import { panelLine, type PanelState } from "./common.js";

function hasObservation(worker: Worker | WorkerObservation): worker is WorkerObservation {
  return "observability" in worker && worker.observability !== undefined;
}

export function renderWorkerPanel(state: PanelState<Worker | WorkerObservation>, width: number): string[] {
  if (state.kind === "loading") return ["Worker", "Loading Worker…"];
  if (state.kind === "error") return ["Worker", panelLine(`Unable to read Worker: ${state.message}`, width)];
  if (state.kind === "empty") return ["Worker", "No Worker data."];
  const worker = state.value;
  const lines = [
    `• ${worker.workerId} · ${worker.status}`,
    `department: ${worker.departmentId} · plan v${worker.planVersion} · item ${worker.itemId}`,
    `execution: ${worker.executionRef} · invocation: ${worker.invocationRef}`,
    `attempt: ${worker.attempt} · answer: ${worker.answerText ?? "unavailable"} · tokens: ${worker.usageTotalTokens ?? "unavailable"}`,
    `bundle content hash: ${worker.bundleContentHash}`,
  ];
  if (hasObservation(worker)) {
    lines.push(`stop state: ${worker.observability.stopState}`);
    lines.push(`capability journal: ${JSON.stringify(worker.observability.capabilityJournal)}`);
    lines.push(`ipython session journal: ${JSON.stringify(worker.observability.ipythonSessionJournal)}`);
    lines.push(`tool events: ${JSON.stringify(worker.observability.toolEvents)}`);
    lines.push("Mission unavailable from WorkerObservation route response.");
    lines.push("Evidence references unavailable from WorkerObservation route response.");
  } else {
    lines.push("Observation unavailable from Worker route response.");
    lines.push("Mission unavailable from Worker route response.");
    lines.push("Evidence references unavailable from Worker route response.");
  }
  return ["Worker", ...lines.map((line) => panelLine(line, width))];
}
