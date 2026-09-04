import {
  CreateGoalInputSchema,
  EventQuerySchema,
  GoalEventPageSchema,
  GoalQuerySchema,
  GoalListSchema,
  GoalBudgetSummarySchema,
  GoalResultSchema,
  MetronomeChallengeListSchema, EncoreCouncilRoundListSchema, CertificationListSchema, ConcertmasterFinalReportSchema,
  type MetronomeChallengeList, type EncoreCouncilRoundList, type CertificationList, type ConcertmasterFinalReport,
  StableApiErrorSchema,
  TransitionGoalInputSchema,
  UuidSchema,
  type CreateGoalInput,
  type EventQuery,
  type GoalEventPage,
  type GoalEvent,
  type GoalQuery,
  type GoalList,
  type GoalBudgetSummary,
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
  listGoals(projectId: string): Promise<GoalList>;
  getGoal(goalId: string, query: GoalQuery): Promise<GoalResult>;
  transitionGoal(goalId: string, input: TransitionGoalInput, commandId: string): Promise<GoalResult>;
  getBudgetSummary(goalId: string, query: GoalQuery): Promise<GoalBudgetSummary>;
  listEvents(query: EventQuery): Promise<GoalEventPage>;
  listMetronomeChallenges(goalId: string, query: GoalQuery): Promise<MetronomeChallengeList>;
  listEncoreCouncilRounds(goalId: string, query: GoalQuery): Promise<EncoreCouncilRoundList>;
  listCertifications(goalId: string, query: GoalQuery): Promise<CertificationList>;
  getConcertmasterReport(goalId: string, query: GoalQuery): Promise<ConcertmasterFinalReport>;
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
    listGoals(projectId) {
      const parsedProjectId = UuidSchema.parse(projectId);
      return request(`v1/goals?${new URLSearchParams({ projectId: parsedProjectId })}`, { headers }, GoalListSchema);
    },
    getGoal(goalId, query) {
      const parsedGoalId = UuidSchema.parse(goalId);
      const parsedQuery = GoalQuerySchema.parse(query);
      return request(`v1/goals/${encodeURIComponent(parsedGoalId)}?${new URLSearchParams({ projectId: parsedQuery.projectId })}`, { headers }, GoalResultSchema);
    },
    getBudgetSummary(goalId, query) {
      const parsed = GoalQuerySchema.parse(query);
      return request(`v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/budget?${new URLSearchParams({ projectId: parsed.projectId })}`, { headers }, GoalBudgetSummarySchema);
    },
    transitionGoal(goalId, input, commandId) {
      return request(`v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/transitions`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
        body: JSON.stringify(TransitionGoalInputSchema.parse(input)),
      }, GoalResultSchema);
    },
    listMetronomeChallenges(goalId, query) {
      const parsed = GoalQuerySchema.parse(query);
      return request(`v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/metronome-challenges?${new URLSearchParams({ projectId: parsed.projectId })}`, { headers }, MetronomeChallengeListSchema);
    },
    listEncoreCouncilRounds(goalId, query) {
      const parsed = GoalQuerySchema.parse(query);
      return request(`v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/encore-council-rounds?${new URLSearchParams({ projectId: parsed.projectId })}`, { headers }, EncoreCouncilRoundListSchema);
    },
    listCertifications(goalId, query) {
      const parsed = GoalQuerySchema.parse(query);
      return request(`v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/certifications?${new URLSearchParams({ projectId: parsed.projectId })}`, { headers }, CertificationListSchema);
    },
    getConcertmasterReport(goalId, query) {
      const parsed = GoalQuerySchema.parse(query);
      return request(`v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/concertmaster-report?${new URLSearchParams({ projectId: parsed.projectId })}`, { headers }, ConcertmasterFinalReportSchema);
    },
    listEvents(query) {
      const parsed = EventQuerySchema.parse(query);
      return request(`v1/events?${new URLSearchParams({ projectId: parsed.projectId, after: parsed.after })}`, { headers }, GoalEventPageSchema);
    },
  };
}

export type { CreateGoalInput, EventQuery, GoalEvent, GoalEventPage, GoalQuery, GoalList, GoalBudgetSummary, GoalResult, TransitionGoalInput, MetronomeChallengeList, EncoreCouncilRoundList, CertificationList, ConcertmasterFinalReport };
