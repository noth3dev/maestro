import type { Worker } from "@maestro/contracts";
import { panelLine, type PanelState } from "./common.js";

export function renderWorkerPanel(state: PanelState<Worker>, width: number): string[] {
  if (state.kind === "loading") return ["Worker", "Loading Worker…"];
  if (state.kind === "error") return ["Worker", panelLine(`Unable to read Worker: ${state.message}`, width)];
  if (state.kind === "empty") return ["Worker", "No Worker data."];
  const worker = state.value;
  const lines = [`• ${worker.workerId} · ${worker.status}`, `department: ${worker.departmentId} · plan v${worker.planVersion} · item ${worker.itemId}`, `execution: ${worker.executionRef} · invocation: ${worker.invocationRef}`, `attempt: ${worker.attempt} · answer: ${worker.answerText ?? "unavailable"} · tokens: ${worker.usageTotalTokens ?? "unavailable"}`, `bundle content hash: ${worker.bundleContentHash}`, "Mission unavailable from Worker route response.", "Evidence references unavailable from Worker route response."];
  return ["Worker", ...lines.map((line) => panelLine(line, width))];
}
