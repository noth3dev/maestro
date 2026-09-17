import {
  MetronomeScanInputSchema,
  MetronomeCorrectionInputSchema,
  MetronomeSafePauseInputSchema,
  MetronomeResolutionInputSchema,
  MetronomeFindingListSchema,
  RaiseMetronomeChallengeInputSchema,
  MetronomeChallengeSchema,
  EncoreReviewInputSchema,
  EncoreCouncilResultSchema,
  UuidSchema,
} from "@maestro/contracts";
import type { ApiClient } from "../client.js";
import type { MethodContext } from "../context.js";

export function createOversightMethods(
  ctx: MethodContext,
): Pick<
  ApiClient,
  | "scanMetronome"
  | "raiseMetronomeChallenge"
  | "requestMetronomeCorrection"
  | "requestMetronomeSafePause"
  | "resolveMetronomeChallenge"
  | "runEncoreReview"
> {
  const { request, headers } = ctx;
  return {
    scanMetronome(goalId, input, commandId) {
      return request(
        `v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/metronome/scan`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(MetronomeScanInputSchema.parse(input)),
        },
        MetronomeFindingListSchema,
      );
    },
    raiseMetronomeChallenge(goalId, input, commandId) {
      return request(
        `v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/metronome/challenges`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(RaiseMetronomeChallengeInputSchema.parse(input)),
        },
        MetronomeChallengeSchema,
      );
    },
    requestMetronomeCorrection(challengeId, input, commandId) {
      const parsedChallengeId = UuidSchema.parse(challengeId);
      return request(
        `v1/metronome/challenges/${encodeURIComponent(parsedChallengeId)}/correction`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(MetronomeCorrectionInputSchema.parse(input)),
        },
        MetronomeChallengeSchema,
      );
    },
    requestMetronomeSafePause(goalId, challengeId, input, commandId) {
      const parsedGoalId = UuidSchema.parse(goalId);
      const parsedChallengeId = UuidSchema.parse(challengeId);
      return request(
        `v1/goals/${encodeURIComponent(parsedGoalId)}/metronome/challenges/${encodeURIComponent(parsedChallengeId)}/safe-pause`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(MetronomeSafePauseInputSchema.parse(input)),
        },
        MetronomeChallengeSchema,
      );
    },
    resolveMetronomeChallenge(challengeId, input, commandId) {
      const parsedChallengeId = UuidSchema.parse(challengeId);
      return request(
        `v1/metronome/challenges/${encodeURIComponent(parsedChallengeId)}/resolve`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(MetronomeResolutionInputSchema.parse(input)),
        },
        MetronomeChallengeSchema,
      );
    },
    runEncoreReview(goalId, input, commandId) {
      return request(
        `v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/encore/reviews`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(EncoreReviewInputSchema.parse(input)),
        },
        EncoreCouncilResultSchema,
      );
    },
  };
}
