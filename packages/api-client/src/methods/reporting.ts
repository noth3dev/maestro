import {
  GoalQuerySchema,
  MetronomeChallengeListSchema,
  EncoreCouncilRoundListSchema,
  CertificationListSchema,
  ConcertmasterFinalReportSchema,
  EvidenceBundleReadSchema,
  GoalGitIntegrationStateSchema,
  WorkerListSchema,
  ImprovementDigestListSchema,
  ArrangementsReadSchema,
  PersonaInspectionSchema,
  PersonaReadQuerySchema,
  PersonaProposalInputSchema,
  ImprovementCandidateResponseSchema,
  UuidSchema,
} from "@maestro/contracts";
import type { ApiClient } from "../client.js";
import type { MethodContext } from "../context.js";

export function createReportingMethods(
  ctx: MethodContext,
): Pick<
  ApiClient,
  | "listMetronomeChallenges"
  | "listEncoreCouncilRounds"
  | "listCertifications"
  | "generateConcertmasterReport"
  | "getConcertmasterReport"
  | "getEvidenceBundle"
  | "getGitIntegrationState"
  | "listWorkersForGoal"
  | "listImprovementDigestsForGoal"
  | "getArrangements"
  | "getPersona"
  | "proposePersona"
  | "editPersonaCandidate"
> {
  const { request, headers } = ctx;
  return {
    listMetronomeChallenges(goalId, query) {
      const parsed = GoalQuerySchema.parse(query);
      return request(
        `v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/metronome-challenges?${new URLSearchParams({ projectId: parsed.projectId })}`,
        { headers },
        MetronomeChallengeListSchema,
      );
    },
    listEncoreCouncilRounds(goalId, query) {
      const parsed = GoalQuerySchema.parse(query);
      return request(
        `v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/encore-council-rounds?${new URLSearchParams({ projectId: parsed.projectId })}`,
        { headers },
        EncoreCouncilRoundListSchema,
      );
    },
    listCertifications(goalId, query) {
      const parsed = GoalQuerySchema.parse(query);
      return request(
        `v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/certifications?${new URLSearchParams({ projectId: parsed.projectId })}`,
        { headers },
        CertificationListSchema,
      );
    },
    generateConcertmasterReport(goalId, query, commandId) {
      const parsed = GoalQuerySchema.parse(query);
      return request(
        `v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/concertmaster-report`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(parsed),
        },
        ConcertmasterFinalReportSchema,
      );
    },
    getConcertmasterReport(goalId, query) {
      const parsed = GoalQuerySchema.parse(query);
      return request(
        `v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/concertmaster-report?${new URLSearchParams({ projectId: parsed.projectId })}`,
        { headers },
        ConcertmasterFinalReportSchema,
      );
    },
    getEvidenceBundle(goalId, query) {
      const parsed = GoalQuerySchema.parse(query);
      return request(
        `v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/evidence-bundle?${new URLSearchParams({ projectId: parsed.projectId })}`,
        { headers },
        EvidenceBundleReadSchema,
      );
    },
    getGitIntegrationState(goalId, query) {
      const parsed = GoalQuerySchema.parse(query);
      return request(
        `v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/git/integration-state?${new URLSearchParams({ projectId: parsed.projectId })}`,
        { headers },
        GoalGitIntegrationStateSchema,
      );
    },
    listWorkersForGoal(goalId, query) {
      const parsed = GoalQuerySchema.parse(query);
      return request(
        `v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/workers?${new URLSearchParams({ projectId: parsed.projectId })}`,
        { headers },
        WorkerListSchema,
      );
    },
    listImprovementDigestsForGoal(goalId, query) {
      const parsed = GoalQuerySchema.parse(query);
      return request(
        `v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/improvement-digests?${new URLSearchParams({ projectId: parsed.projectId })}`,
        { headers },
        ImprovementDigestListSchema,
      );
    },
    getArrangements(goalId, query) {
      const parsed = GoalQuerySchema.parse(query);
      return request(
        `v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/arrangements?${new URLSearchParams({ projectId: parsed.projectId })}`,
        { headers },
        ArrangementsReadSchema,
      );
    },
    getPersona(query) {
      const parsed = PersonaReadQuerySchema.parse(query);
      return request(
        `v1/persona?${new URLSearchParams({ projectId: parsed.projectId, goalId: parsed.goalId, roleId: parsed.roleId, taskClass: parsed.taskClass })}`,
        { headers },
        PersonaInspectionSchema,
      );
    },
    proposePersona(input, commandId) {
      const parsed = PersonaProposalInputSchema.parse(input);
      return request(
        "v1/persona/proposals",
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(parsed),
        },
        ImprovementCandidateResponseSchema,
      );
    },
    editPersonaCandidate(candidateId, input, commandId) {
      const parsed = PersonaProposalInputSchema.parse(input);
      return request(
        `v1/persona/candidates/${encodeURIComponent(UuidSchema.parse(candidateId))}/edits`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(parsed),
        },
        ImprovementCandidateResponseSchema,
      );
    },
  };
}
