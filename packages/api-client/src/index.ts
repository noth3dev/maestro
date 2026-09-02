import {
  CreateGoalInputSchema,
  EventQuerySchema,
  GoalEventPageSchema,
  GoalQuerySchema,
  GoalResultSchema,
  SentinelChallengeListSchema, OverwatchCouncilRoundListSchema, CertificationListSchema, SaneFinalReportSchema,
  type SentinelChallengeList, type OverwatchCouncilRoundList, type CertificationList, type SaneFinalReport,
  StableApiErrorSchema,
  TransitionGoalInputSchema,
  UuidSchema,
  type CreateGoalInput,
  type EventQuery,
  type GoalEventPage,
  type GoalEvent,
  type GoalQuery,
  type GoalResult,
  type StableApiError,
  type TransitionGoalInput,
} from "@maestro/contracts";

export class ApiError extends Error {
  readonly name = "ApiError";

  constructor(
    readonly status: number,
    readonly code: StableApiError["error"]["code"],
    message: string,
  ) {
    super(message);
  }
}

export interface ApiClient {
  createGoal(input: CreateGoalInput, commandId: string): Promise<GoalResult>;
  getGoal(goalId: string, query: GoalQuery): Promise<GoalResult>;
  transitionGoal(goalId: string, input: TransitionGoalInput, commandId: string): Promise<GoalResult>;
  listEvents(query: EventQuery): Promise<GoalEventPage>;
  listSentinelChallenges(goalId: string): Promise<SentinelChallengeList>;
  listOverwatchCouncilRounds(goalId: string): Promise<OverwatchCouncilRoundList>;
  listCertifications(goalId: string): Promise<CertificationList>;
  getSaneReport(goalId: string): Promise<SaneFinalReport>;
}

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createApiClient({ baseUrl, token, fetch = globalThis.fetch }: { baseUrl: string; token: string; fetch?: Fetch }): ApiClient {
  const base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const request = async <T>(path: string, init: RequestInit, parse: { parse(value: unknown): T }): Promise<T> => {
    let response: Response;
    try {
      response = await fetch(new URL(path, base).href, init);
    } catch {
      throw new Error("Control plane request failed");
    }
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const stable = StableApiErrorSchema.safeParse(body);
      if (stable.success) throw new ApiError(response.status, stable.data.error.code, stable.data.error.message);
      throw new Error(`Control plane returned HTTP ${response.status}`);
    }
    return parse.parse(body);
  };
  const headers = { authorization: `Bearer ${token}` };

  return {
    createGoal(input, commandId) {
      return request("v1/goals", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
        body: JSON.stringify(CreateGoalInputSchema.parse(input)),
      }, GoalResultSchema);
    },
    getGoal(goalId, query) {
      const parsedGoalId = UuidSchema.parse(goalId);
      const parsedQuery = GoalQuerySchema.parse(query);
      return request(`v1/goals/${encodeURIComponent(parsedGoalId)}?${new URLSearchParams({ projectId: parsedQuery.projectId })}`, { headers }, GoalResultSchema);
    },
    transitionGoal(goalId, input, commandId) {
      return request(`v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/transitions`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
        body: JSON.stringify(TransitionGoalInputSchema.parse(input)),
      }, GoalResultSchema);
    },
    listSentinelChallenges(goalId) { return request(`v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/sentinel-challenges`, { headers }, SentinelChallengeListSchema); },
    listOverwatchCouncilRounds(goalId) { return request(`v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/overwatch-council-rounds`, { headers }, OverwatchCouncilRoundListSchema); },
    listCertifications(goalId) { return request(`v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/certifications`, { headers }, CertificationListSchema); },
    getSaneReport(goalId) { return request(`v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/sane-report`, { headers }, SaneFinalReportSchema); },
    listEvents(query) {
      const parsed = EventQuerySchema.parse(query);
      return request(`v1/events?${new URLSearchParams({ projectId: parsed.projectId, after: parsed.after })}`, { headers }, GoalEventPageSchema);
    },
  };
}

export type { CreateGoalInput, EventQuery, GoalEvent, GoalEventPage, GoalQuery, GoalResult, TransitionGoalInput, SentinelChallengeList, OverwatchCouncilRoundList, CertificationList, SaneFinalReport };
