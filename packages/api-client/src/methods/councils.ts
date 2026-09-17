import {
  HeadParticipationInputSchema,
  HeadParticipationSchema,
  CreateHeadCouncilInputSchema,
  SubmitCouncilBriefInputSchema,
  HeadCouncilDecisionInputSchema,
  HeadCouncilSchema,
  UuidSchema,
} from "@maestro/contracts";
import type { ApiClient } from "../client.js";
import type { MethodContext } from "../context.js";

export function createCouncilsMethods(
  ctx: MethodContext,
): Pick<ApiClient, "activateHead" | "createCouncil" | "getCouncil" | "submitCouncilBrief" | "revealCouncil" | "decideCouncil"> {
  const { request, headers } = ctx;
  return {
    activateHead(goalId, input, commandId) {
      const parsedGoalId = UuidSchema.parse(goalId);
      return request(
        `v1/goals/${encodeURIComponent(parsedGoalId)}/head-participations`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(HeadParticipationInputSchema.parse(input)),
        },
        HeadParticipationSchema,
      );
    },
    createCouncil(goalId, input, commandId) {
      return request(
        `v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/councils`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(CreateHeadCouncilInputSchema.parse(input)),
        },
        HeadCouncilSchema,
      );
    },
    getCouncil(councilId, projectId) {
      return request(
        `v1/councils/${encodeURIComponent(UuidSchema.parse(councilId))}?${new URLSearchParams({ projectId: UuidSchema.parse(projectId) })}`,
        { headers },
        HeadCouncilSchema,
      );
    },
    submitCouncilBrief(councilId, departmentId, input, commandId) {
      const parsedCouncilId = UuidSchema.parse(councilId);
      if (!/^[A-Za-z0-9:_-]+$/.test(departmentId)) throw new Error("Invalid department ID");
      return request(
        `v1/councils/${encodeURIComponent(parsedCouncilId)}/briefs/${encodeURIComponent(departmentId)}`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(SubmitCouncilBriefInputSchema.parse(input)),
        },
        { parse: () => undefined },
      );
    },
    revealCouncil(councilId, projectId, commandId) {
      return request(
        `v1/councils/${encodeURIComponent(UuidSchema.parse(councilId))}/reveal`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify({ projectId: UuidSchema.parse(projectId) }),
        },
        { parse: () => undefined },
      );
    },
    decideCouncil(councilId, input, commandId) {
      return request(
        `v1/councils/${encodeURIComponent(UuidSchema.parse(councilId))}/decision`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(HeadCouncilDecisionInputSchema.parse(input)),
        },
        HeadCouncilSchema,
      );
    },
  };
}
