import type { EvidenceRecord } from "@maestro/evidence";
import { FileEvidenceStore } from "@maestro/evidence";
import { appendEvidenceMetadata } from "@maestro/persistence";
import type { OperatorContext } from "@maestro/persistence";
import type { Pool } from "pg";
import type { EvidenceCaptureInput } from "@maestro/contracts";

export interface EvidenceCaptureService {
  capture(input: EvidenceCaptureInput & { readonly goalId: string }, actor: OperatorContext): Promise<EvidenceRecord>;
}

export interface EvidenceCaptureServiceDependencies {
  readonly pool: Pool;
  readonly store: FileEvidenceStore;
  readonly assertGoalProjectBinding: (projectId: string, goalId: string) => Promise<void>;
}

export class EvidenceCaptureError extends Error {
  constructor(message: string) { super(message); this.name = "EvidenceCaptureError"; }
}

export function createEvidenceCaptureService(deps: EvidenceCaptureServiceDependencies): EvidenceCaptureService {
  return {
    async capture(input, actor) {
      await deps.assertGoalProjectBinding(input.projectId, input.goalId);
      const bytes = Buffer.from(input.contentBase64, "base64");
      if (bytes.length === 0) throw new EvidenceCaptureError("Evidence content must not be empty");
      const canonical = bytes.toString("base64").replace(/=+$/, "");
      if (canonical !== input.contentBase64.replace(/=+$/, "")) throw new EvidenceCaptureError("Evidence contentBase64 is invalid");
      const captured = await deps.store.capture({
        context: { correlationId: input.correlationId, commandId: input.commandId, projectId: input.projectId, goalId: input.goalId, actorId: actor.operatorId },
        bytes, kind: input.kind, mediaType: input.mediaType,
      });
      return appendEvidenceMetadata(deps.pool, captured);
    },
  };
}
