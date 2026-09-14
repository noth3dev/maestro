import type { CertificationList } from "@maestro/api-client";
import { panelLine, type PanelState } from "./common.js";

type Certification = CertificationList["certifications"][number];

export function renderCertificationPanel(state: PanelState<readonly Certification[]>, width: number): string[] {
  if (state.kind === "loading") return ["Certifications", "Loading certifications…"];
  if (state.kind === "error") return ["Certifications", panelLine(`Unable to read certifications: ${state.message}`, width)];
  if (state.kind === "empty" || state.value.length === 0) return ["Certifications", "No certifications found."];
  const lines: string[] = [];
  for (const certification of state.value) lines.push(`• ${certification.certificationId} · ${certification.kind} · ${certification.verdict}`, `  contract: ${certification.contractId} v${certification.contractVersion} · hash ${certification.contractContentHash}`, `  commit: ${certification.integratedCommitSha}`, `  worker: ${certification.workerId} · department acceptance: ${certification.departmentAcceptanceId} · integration revision: ${certification.integrationRevisionId}`, `  certified by: ${certification.certifiedByDepartment} · producing: ${certification.producingDepartment}`);
  lines.push("Evidence and findings unavailable from certification-list route response.");
  return ["Certifications", ...lines.map((line) => panelLine(line, width))];
}
