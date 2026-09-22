import type { ApiClient, PersonaInspection, PersonaProposalInput } from "@maestro/api-client";
import type { ImprovementCandidate } from "@maestro/domain";

/** The renderer may read and submit persona candidates only through these typed Control Plane methods. */
export type PersonaApi = Pick<ApiClient, "getPersona" | "proposePersona" | "editPersonaCandidate">;
export type PersonaQuery = Parameters<ApiClient["getPersona"]>[0];

/** Read-only Act 3 surfaces are limited to durable arrangement, digest, and Encore reads. */
export type ArrangementApi = Pick<ApiClient, "getArrangements" | "listImprovementDigestsForGoal" | "listEncoreCouncilRounds">;

export function getPersona(api: Pick<PersonaApi, "getPersona">, query: PersonaQuery): Promise<PersonaInspection> {
  return api.getPersona(query);
}

export function proposePersona(
  api: Pick<PersonaApi, "proposePersona">,
  input: PersonaProposalInput,
  commandId: string,
): Promise<ImprovementCandidate> {
  return api.proposePersona(input, commandId);
}

export function editPersonaCandidate(
  api: Pick<PersonaApi, "editPersonaCandidate">,
  candidateId: string,
  input: PersonaProposalInput,
  commandId: string,
): Promise<ImprovementCandidate> {
  return api.editPersonaCandidate(candidateId, input, commandId);
}

/** Active profile version and candidate versions are independent server records. */
export function isActivePersonaCandidate(model: PersonaInspection, candidateId: string): boolean {
  return model.rollouts.some((rollout) => rollout.status === "active" && rollout.activeCandidateId === candidateId);
}

export function personaErrorMessage(error: unknown, fallback = "Persona request failed"): string {
  if (typeof error === "object" && error !== null) {
    const candidate = error as { code?: unknown; detail?: unknown; message?: unknown };
    if (candidate.code === "version_conflict" || candidate.code === "encore_conflict") {
      return "This persona candidate changed elsewhere. Reload the server state before editing again.";
    }
    if (typeof candidate.detail === "string" && candidate.detail.trim() !== "") return candidate.detail;
    if (typeof candidate.message === "string" && candidate.message.trim() !== "") return candidate.message;
  }
  return error instanceof Error && error.message.trim() !== "" ? error.message : fallback;
}
