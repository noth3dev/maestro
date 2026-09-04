import { describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { buildServer, type EventService, type GoalService, type OperatorAuthenticator, type HeadParticipationService, type CouncilService, type EncoreService } from "./server.js";
import type { ReadStateService } from "./read-state-service.js";
import { ProjectMembershipRequiredError, StaleGoalLeaseError, HeadActivationRequesterInactiveError } from "@maestro/persistence";

const goal = { goalId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f02", projectId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f01", state: "draft" as const, version: 1 };

const operator = { operatorId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f05", credentialId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f06" };

function authenticated(): OperatorAuthenticator {
  return { authenticateBearerSecret: async () => ({ outcome: "authenticated", operator }) };
}

function buildAuthenticatedServer(goalService: GoalService, authenticator: OperatorAuthenticator = authenticated()) {
  return buildServer({ goalService, authenticator });
}

const event = { cursor: "9007199254740993", eventId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f02", projectId: goal.projectId, goalId: goal.goalId, aggregateVersion: "1", eventType: "GoalCreated", schemaVersion: 1, payload: { state: "draft" }, occurredAt: "2025-01-01T00:00:00.000Z" };
function fakeEvents(overrides: Partial<EventService> = {}): EventService { return { listEvents: async () => [event], ...overrides }; }

const state: ReadStateService = { listGoals: async () => [goal], getBudgetSummary: async () => ({ goalId: goal.goalId, projectId: goal.projectId, budgetCents: 10, reservedCents: 4, costCents: 3 }), listMetronomeChallenges: async () => [{ challengeId: goal.goalId, goalId: goal.goalId, reason: "r", evidenceReferences: [], status: "open", correctionRequest: null, raisedBy: "metronome", resolvedBy: null, resolutionReason: null }], listEncoreCouncilRounds: async () => [], listCertifications: async () => [], getConcertmasterReport: async () => undefined };

function fakeService(overrides: Partial<GoalService> = {}): GoalService {
  return {
    createGoal: async () => goal,
    transitionGoal: async () => ({ ...goal, state: "ready_for_confirmation", version: 2 }),
    pauseGoal: async () => ({ ...goal, state: "pausing", version: 2 }),
    stopGoal: async () => ({ ...goal, state: "stopping", version: 2 }),
    resumeGoal: async () => ({ ...goal, state: "resuming", version: 2 }),
    emergencyStopGoal: async () => ({ ...goal, state: "stopped", version: 2 }),
    getGoal: async () => goal,
    ...overrides,
  };
}

describe("health routes", () => {
  it("serves unauthenticated liveness and readiness checks", async () => {
    const app = buildServer({ goalService: fakeService(), authenticator: authenticated(), readinessCheck: async () => {} });
    expect((await app.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/readyz" })).statusCode).toBe(200);
    await app.close();
  });

  it("fails readiness when the configured dependency check fails", async () => {
    const app = buildServer({ goalService: fakeService(), authenticator: authenticated(), readinessCheck: async () => { throw new Error("database unavailable"); } });
    expect((await app.inject({ method: "GET", url: "/readyz" })).statusCode).toBe(503);
    await app.close();
  });
});

describe("read state routes", () => {
  it("lists Goals and returns a project-bound budget summary", async () => {
    const app = buildServer({ goalService: fakeService(), authenticator: authenticated(), readStateService: state });
    const headers = { authorization: "Bearer test-secret" };
    expect((await app.inject({ method: "GET", url: `/v1/goals?projectId=${goal.projectId}`, headers })).json()).toEqual({ goals: [goal] });
    expect((await app.inject({ method: "GET", url: `/v1/goals/${goal.goalId}/budget?projectId=${goal.projectId}`, headers })).json()).toEqual({ goalId: goal.goalId, projectId: goal.projectId, budgetCents: 10, reservedCents: 4, costCents: 3 });
    await app.close();
  });

  it("returns all four goal-scoped state shapes", async () => {
    const app = buildServer({ goalService: fakeService(), authenticator: authenticated(), readStateService: state });
    const headers = { authorization: "Bearer test-secret" };
    expect((await app.inject({ method: "GET", url: `/v1/goals/${goal.goalId}/metronome-challenges?projectId=${goal.projectId}`, headers })).json().challenges).toHaveLength(1);
    expect((await app.inject({ method: "GET", url: `/v1/goals/${goal.goalId}/encore-council-rounds?projectId=${goal.projectId}`, headers })).json()).toEqual({ rounds: [] });
    expect((await app.inject({ method: "GET", url: `/v1/goals/${goal.goalId}/certifications?projectId=${goal.projectId}`, headers })).json()).toEqual({ certifications: [] });
    expect((await app.inject({ method: "GET", url: `/v1/goals/${goal.goalId}/concertmaster-report?projectId=${goal.projectId}`, headers })).statusCode).toBe(404);
    await app.close();
  });
});

describe("head participation routes", () => {
  it("passes only validated project-bound activation input and the authenticated operator", async () => {
    const participation = { goalId: goal.goalId, departmentId: "product", headRoleId: "head:product", contractId: null, contextId: null, status: "active" as const, activeSessionRef: "execution-1" };
    const activate = vi.fn(async () => participation);
    const headParticipationService: HeadParticipationService = { activate };
    const app = buildServer({ goalService: fakeService(), authenticator: authenticated(), headParticipationService });
    const input = {
      projectId: goal.projectId, departmentId: "product", requestedContribution: "implement", urgency: "normal",
      contextScope: ["contract"], budgetEffect: "none", reason: "goal launch",
    };
    const commandId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f0a";
    const response = await app.inject({ method: "POST", url: `/v1/goals/${goal.goalId}/head-participations`, headers: { authorization: "Bearer test-secret", "idempotency-key": commandId }, payload: input });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(participation);
    expect(activate).toHaveBeenCalledWith(goal.goalId, input, operator, commandId);
    await app.close();
  });
});

describe("Head Council routes", () => {
  it("uses authenticated, idempotent command identities for council lifecycle writes", async () => {
    const council = { councilId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f07", goalId: goal.goalId, contractId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f08", briefDeadline: "2030-01-01T00:00:00.000Z", state: "resolved" as const, noNewEvidenceStreak: 0, decisionPacket: null, snapshotHash: "a".repeat(64), snapshot: {} };
    const create = vi.fn(async () => council);
    const submitBrief = vi.fn(async () => {});
    const reveal = vi.fn(async () => {});
    const decide = vi.fn(async () => council);
    const councils: CouncilService = { create, get: async () => council, submitBrief, reveal, decide };
    const app = buildServer({ goalService: fakeService(), authenticator: authenticated(), councilService: councils });
    const headers = { authorization: "Bearer test-secret", "content-type": "application/json" };
    const commandId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f09";
    const createInput = { projectId: goal.projectId, contractId: council.contractId, briefDeadline: council.briefDeadline, evidence: {} };
    const created = await app.inject({ method: "POST", url: `/v1/goals/${goal.goalId}/councils`, headers: { ...headers, "idempotency-key": commandId }, payload: createInput });
    expect(created.statusCode).toBe(201);
    expect(create).toHaveBeenCalledWith(goal.goalId, createInput, commandId, operator);
    const submitted = await app.inject({ method: "POST", url: `/v1/councils/${council.councilId}/briefs/product`, headers: { ...headers, "idempotency-key": commandId }, payload: { projectId: goal.projectId, brief: { interpretation: "safe", contribution: "review", nonGoals: [], assumptions: [], evidenceGaps: [], risks: [], dependencies: [], proposedValidation: [], expectedWorkers: [], expectedCost: "1", expectedTime: "1", objectionsToLikelyAlternatives: [] } } });
    expect(submitted.statusCode).toBe(204);
    expect(submitBrief).toHaveBeenCalled();
    await app.close();
  });
});

describe("Encore and persistence error routes", () => {
  it("forwards the idempotency key to Encore and maps stale durable leases", async () => {
    const commandId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f0a";
    const input = { projectId: goal.projectId, question: "should we proceed?", criteria: [{ criterionId: "safety", description: "preserve safety" }], evidenceIds: [], reviewerCount: 1 };
    const result = { roundId: commandId, judgments: [{ modelProvider: "prime", modelId: "kimi", verdict: "proceed" as const, confidence: "high" as const, reasoning: "safe", conditions: [], dissentNote: null, citedEvidenceIds: [] }], synthesis: { finalVerdict: "proceed" as const, sameModelOnly: true, escalated: false, dissentNotes: [] } };
    const review = vi.fn(async (_goalId: string, _input: typeof input, receivedCommandId: string) => { expect(receivedCommandId).toBe(commandId); return result; });
    const encore: EncoreService = { review };
    const app = buildServer({ goalService: fakeService(), authenticator: authenticated(), encoreService: encore });
    const response = await app.inject({ method: "POST", url: `/v1/goals/${goal.goalId}/encore/reviews`, headers: { authorization: "Bearer test-secret", "idempotency-key": commandId }, payload: input });
    expect(response.statusCode).toBe(201);
    expect(review).toHaveBeenCalledWith(goal.goalId, input, commandId);
    await app.close();

    const stale = buildServer({ goalService: fakeService(), authenticator: authenticated(), encoreService: { review: async () => { throw new StaleGoalLeaseError(goal.goalId); } } });
    const staleResponse = await stale.inject({ method: "POST", url: `/v1/goals/${goal.goalId}/encore/reviews`, headers: { authorization: "Bearer test-secret", "idempotency-key": commandId }, payload: input });
    expect(staleResponse.statusCode).toBe(409);
    expect(staleResponse.json().error.code).toBe("stale_lease");
    await stale.close();
  });

  it("maps an inactive Head requester to a stable conflict", async () => {
    const app = buildServer({ goalService: fakeService(), authenticator: authenticated(), headParticipationService: { activate: async () => { throw new HeadActivationRequesterInactiveError(); } } });
    const response = await app.inject({ method: "POST", url: `/v1/goals/${goal.goalId}/head-participations`, headers: { authorization: "Bearer test-secret", "idempotency-key": "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f0a" }, payload: { projectId: goal.projectId, departmentId: "product", requestedContribution: "implement", urgency: "normal", contextScope: ["goal"], budgetEffect: "none", reason: "launch" } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("head_activation_conflict");
    await app.close();
  });
});

describe("goal routes", () => {
  it("creates, transitions, and reads goals through the injected service", async () => {
    const app = buildAuthenticatedServer(fakeService());
    const create = await app.inject({ method: "POST", url: "/v1/goals", headers: { authorization: "Bearer test-secret", "idempotency-key": "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f03" }, payload: { projectId: goal.projectId } });
    expect(create.statusCode).toBe(201);
    expect(create.json()).toEqual(goal);

    const transition = await app.inject({ method: "POST", url: `/v1/goals/${goal.goalId}/transitions`, headers: { authorization: "Bearer test-secret", "idempotency-key": "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f04" }, payload: { projectId: goal.projectId, expectedVersion: 1, to: "ready_for_confirmation" } });
    expect(transition.statusCode).toBe(200);
    expect(transition.json()).toMatchObject({ state: "ready_for_confirmation", version: 2 });

    const read = await app.inject({ method: "GET", url: `/v1/goals/${goal.goalId}?projectId=${goal.projectId}`, headers: { authorization: "Bearer test-secret" } });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual(goal);
    await app.close();
  });

  it("uses the Idempotency-Key header as the mutation command ID", async () => {
    const createGoal = vi.fn(async () => goal);
    const transitionGoal = vi.fn(async () => ({ ...goal, state: "ready_for_confirmation" as const, version: 2 }));
    const app = buildAuthenticatedServer(fakeService({ createGoal, transitionGoal }));
    const createKey = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f03";
    const transitionKey = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f04";

    await app.inject({ method: "POST", url: "/v1/goals", headers: { authorization: "Bearer test-secret", "idempotency-key": createKey }, payload: { projectId: goal.projectId } });
    await app.inject({ method: "POST", url: `/v1/goals/${goal.goalId}/transitions`, headers: { authorization: "Bearer test-secret", "idempotency-key": transitionKey }, payload: { projectId: goal.projectId, expectedVersion: 1, to: "ready_for_confirmation" } });

    expect(createGoal).toHaveBeenCalledWith({ projectId: goal.projectId }, createKey, operator);
    expect(transitionGoal).toHaveBeenCalledWith(goal.goalId, { projectId: goal.projectId, expectedVersion: 1, to: "ready_for_confirmation" }, transitionKey, operator);
    await app.close();
  });

  it.each([undefined, "not-a-uuid"]) ("rejects a missing or invalid Idempotency-Key without invoking the service", async (idempotencyKey) => {
    const createGoal = vi.fn(async () => goal);
    const app = buildAuthenticatedServer(fakeService({ createGoal }));
    const response = await app.inject({ method: "POST", url: "/v1/goals", headers: idempotencyKey === undefined ? { authorization: "Bearer test-secret" } : { authorization: "Bearer test-secret", "idempotency-key": idempotencyKey }, payload: { projectId: goal.projectId } });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: { code: "validation_error", message: "Invalid request" } });
    expect(createGoal).not.toHaveBeenCalled();
    await app.close();
  });

  it("maps malformed JSON to the stable 400 validation error", async () => {
    const createGoal = vi.fn(async () => goal);
    const app = buildAuthenticatedServer(fakeService({ createGoal }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/goals",
      headers: { authorization: "Bearer test-secret", "content-type": "application/json", "idempotency-key": "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f03" },
      payload: "{",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: { code: "validation_error", message: "Invalid request" } });
    expect(createGoal).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects invalid public input with the stable 400 error", async () => {
    const app = buildAuthenticatedServer(fakeService());
    const response = await app.inject({ method: "POST", url: "/v1/goals", headers: { authorization: "Bearer test-secret", "idempotency-key": "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f03" }, payload: { projectId: goal.projectId, actorId: "private" } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: { code: "validation_error", message: "Invalid request" } });
    await app.close();
  });

  it("rejects a missing bearer token without invoking the Goal service", async () => {
    const createGoal = vi.fn(async () => goal);
    const app = buildServer({ goalService: fakeService({ createGoal }), authenticator: authenticated() });

    const response = await app.inject({ method: "POST", url: "/v1/goals", headers: { "idempotency-key": "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f03" }, payload: { projectId: goal.projectId } });

    expect(response.statusCode).toBe(401);
    expect(createGoal).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects malformed or invalid bearer tokens without invoking the Goal service", async () => {
    const createGoal = vi.fn(async () => goal);
    const authenticator: OperatorAuthenticator = { authenticateBearerSecret: vi.fn(async () => ({ outcome: "invalid" })) };
    const app = buildServer({ goalService: fakeService({ createGoal }), authenticator });

    const response = await app.inject({ method: "POST", url: "/v1/goals", headers: { authorization: "Basic nope", "idempotency-key": "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f03" }, payload: { projectId: goal.projectId } });

    expect(response.statusCode).toBe(401);
    expect(createGoal).not.toHaveBeenCalled();
    expect(authenticator.authenticateBearerSecret).not.toHaveBeenCalled();
    await app.close();
  });

  it("maps saturated local authentication safely without reflecting the bearer secret", async () => {
    const secret = "saturated-secret-must-not-leak";
    const authenticator: OperatorAuthenticator = { authenticateBearerSecret: async () => ({ outcome: "unavailable" }) };
    const app = buildServer({ goalService: fakeService(), authenticator });

    const response = await app.inject({ method: "GET", url: `/v1/goals/${goal.goalId}?projectId=${goal.projectId}`, headers: { authorization: `Bearer ${secret}` } });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({ error: { code: "authentication_unavailable", message: "Authentication is temporarily unavailable" } });
    expect(response.body).not.toContain(secret);
    await app.close();
  });

  it("rejects a revoked credential without invoking the Goal service", async () => {
    const createGoal = vi.fn(async () => goal);
    const authenticator: OperatorAuthenticator = { authenticateBearerSecret: async () => ({ outcome: "forbidden" }) };
    const app = buildServer({ goalService: fakeService({ createGoal }), authenticator });

    const response = await app.inject({ method: "POST", url: "/v1/goals", headers: { authorization: "Bearer revoked-secret", "idempotency-key": "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f03" }, payload: { projectId: goal.projectId } });

    expect(response.statusCode).toBe(403);
    expect(createGoal).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([
    ["VersionConflictError", 409, "version_conflict"],
    ["InvalidTransitionError", 422, "invalid_transition"],
    ["GoalNotFoundError", 404, "goal_not_found"],
    ["StaleLeaseError", 409, "stale_lease"],
    ["LeaseUnavailableError", 423, "lease_unavailable"],
    ["CommandIdReuseError", 409, "command_id_reused"],
    ["DurableStoreUnavailableError", 503, "durable_store_unavailable"],
  ])("maps %s to stable HTTP errors", async (name, status, code) => {
    const errors = await import("./goal-service.js");
    const ErrorType = errors[name as keyof typeof errors] as new () => Error;
    const app = buildAuthenticatedServer(fakeService({ getGoal: async () => { throw new ErrorType(); } }));
    const response = await app.inject({ method: "GET", url: `/v1/goals/${goal.goalId}?projectId=${goal.projectId}`, headers: { authorization: "Bearer test-secret" } });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({ error: { code, message: expect.any(String) } });
    await app.close();
  });

  it.each(["not-a-cursor", "9223372036854775808"])("rejects malformed or out-of-range Last-Event-ID before starting a stream", async (lastEventId) => {
    const listEvents = vi.fn(async () => [event]);
    const app = buildServer({ goalService: fakeService(), authenticator: authenticated(), eventService: fakeEvents({ listEvents }) });

    const response = await app.inject({ method: "GET", url: `/v1/events/stream?projectId=${goal.projectId}`, headers: { authorization: "Bearer test-secret", "last-event-id": lastEventId } });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: { code: "validation_error", message: "Invalid request" } });
    expect(listEvents).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects a Last-Event-ID that disagrees with the query cursor before starting a stream", async () => {
    const listEvents = vi.fn(async () => [event]);
    const app = buildServer({ goalService: fakeService(), authenticator: authenticated(), eventService: fakeEvents({ listEvents }) });

    const response = await app.inject({ method: "GET", url: `/v1/events/stream?projectId=${goal.projectId}&after=1`, headers: { authorization: "Bearer test-secret", "last-event-id": "2" } });

    expect(response.statusCode).toBe(400);
    expect(listEvents).not.toHaveBeenCalled();
    await app.close();
  });

  it("requires auth before querying events and validates scoped cursors", async () => {
    const listEvents = vi.fn(async () => [event]);
    const app = buildServer({ goalService: fakeService(), authenticator: authenticated(), eventService: fakeEvents({ listEvents }) });
    const noAuth = await app.inject({ method: "GET", url: `/v1/events?projectId=${goal.projectId}` });
    expect(noAuth.statusCode).toBe(401);
    expect(listEvents).not.toHaveBeenCalled();
    const bad = await app.inject({ method: "GET", url: "/v1/events?after=1" , headers: { authorization: "Bearer test-secret" } });
    expect(bad.statusCode).toBe(400);
    const page = await app.inject({ method: "GET", url: `/v1/events?projectId=${goal.projectId}&after=9007199254740992`, headers: { authorization: "Bearer test-secret" } });
    expect(page.statusCode).toBe(200);
    expect(page.json()).toEqual({ events: [event], nextCursor: event.cursor });
    expect(listEvents).toHaveBeenLastCalledWith(goal.projectId, "9007199254740992");
    const mismatch = await app.inject({ method: "GET", url: `/v1/events/stream?projectId=${goal.projectId}&after=1`, headers: { authorization: "Bearer test-secret", "last-event-id": "2" } });
    expect(mismatch.statusCode).toBe(400);
    await app.close();
  });

});


describe("SSE stream lifecycle", () => {
  it("uses an injected scheduler for ordered replay and later delivery, then stops all scheduled work after cancellation", async () => {
    type Tick = () => void;
    const scheduled: Tick[] = [];
    const scheduler = {
      setInterval: vi.fn((tick: Tick) => { scheduled.push(tick); return tick; }),
      clearInterval: vi.fn((tick: Tick) => { scheduled.splice(scheduled.indexOf(tick), 1); }),
    };
    const later = { ...event, cursor: "9007199254740994", eventId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f04" };
    const listEvents = vi.fn()
      .mockResolvedValueOnce([event])
      .mockResolvedValueOnce([later]);
    const app = buildServer({ goalService: fakeService(), authenticator: authenticated(), eventService: fakeEvents({ listEvents }), pollingScheduler: scheduler });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === "string") throw new Error("Expected TCP listener");
    const response = await openSse(`http://127.0.0.1:${address.port}/v1/events/stream?projectId=${goal.projectId}`);
    const frames: string[] = [];
    response.on("data", (chunk: Buffer) => frames.push(chunk.toString()));
    const initialFrame = once(response, "data");
    response.resume();
    await initialFrame;
    expect(listEvents).toHaveBeenCalledWith(goal.projectId, "0");
    expect(scheduler.setInterval).toHaveBeenCalledOnce();
    expect(frames.join("")).toContain(`id: ${event.cursor}`);

    const laterFrame = once(response, "data");
    scheduled[0]!();
    await laterFrame;
    expect(listEvents.mock.calls).toEqual([[goal.projectId, "0"], [goal.projectId, event.cursor]]);
    expect(frames.join("")).toContain(`id: ${later.cursor}`);

    const closed = once(response, "close");
    response.destroy();
    await closed;
    await new Promise<void>((resolve) => setImmediate(() => setImmediate(resolve)));
    await app.close();
    const callsBefore = listEvents.mock.calls.length;
    const framesBefore = frames.join("");
    expect(scheduler.clearInterval).toHaveBeenCalledOnce();
    expect(scheduled).toEqual([]);
    expect(listEvents).toHaveBeenCalledTimes(callsBefore);
    expect(frames.join("")).toBe(framesBefore);
  });

  it("preClose ends an open stream before unregistering it", async () => {
    const scheduler = { setInterval: vi.fn(() => ({})), clearInterval: vi.fn() };
    let signalInitialQuery!: () => void;
    const initialQueryStarted = new Promise<void>((resolve) => { signalInitialQuery = resolve; });
    const app = buildServer({
      goalService: fakeService(),
      authenticator: authenticated(),
      eventService: fakeEvents({ listEvents: async () => { signalInitialQuery(); return []; } }),
      pollingScheduler: scheduler,
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === "string") throw new Error("Expected TCP listener");
    const response = await openSse(`http://127.0.0.1:${address.port}/v1/events/stream?projectId=${goal.projectId}`);
    await initialQueryStarted;
    await app.close();
    response.destroy();
    expect(scheduler.clearInterval).toHaveBeenCalledOnce();
  });
});

function openSse(url: string): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { headers: { authorization: "Bearer test-secret" } });
    request.once("response", (response) => {
      // Keep initial SSE frames buffered until the test installs its listener.
      response.pause();
      resolve(response);
    });
    request.once("error", reject);
    request.end();
  });
}


describe("project-scoped authorization (Phase 1 re-patch item 8)", () => {
  function checker(allowedProjectIds: readonly string[]) {
    return {
      assertProjectMembership: vi.fn(async (operatorId: string, projectId: string) => {
        if (!allowedProjectIds.includes(projectId)) throw new ProjectMembershipRequiredError(operatorId, projectId);
      }),
    };
  }

  it("allows a request whose stated projectId the operator has active membership for", async () => {
    const projectMembership = checker([goal.projectId]);
    const app = buildServer({ goalService: fakeService(), authenticator: authenticated(), projectMembership });
    const response = await app.inject({
      method: "POST", url: "/v1/goals",
      headers: { authorization: "Bearer test-secret", "idempotency-key": "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f07" },
      payload: { projectId: goal.projectId },
    });
    expect(response.statusCode).toBe(201);
    expect(projectMembership.assertProjectMembership).toHaveBeenCalledWith(operator.operatorId, goal.projectId);
    await app.close();
  });

  it("rejects a request whose stated projectId the operator has no active membership for, before the route's own service runs", async () => {
    const projectMembership = checker(["018f3c9b-7e71-7b44-ae23-3b5d4e8c9f99"]);
    const goalService = fakeService({ createGoal: vi.fn(fakeService().createGoal) });
    const app = buildServer({ goalService, authenticator: authenticated(), projectMembership });
    const response = await app.inject({
      method: "POST", url: "/v1/goals",
      headers: { authorization: "Bearer test-secret", "idempotency-key": "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f08" },
      payload: { projectId: goal.projectId },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "project_access_forbidden" } });
    expect(goalService.createGoal).not.toHaveBeenCalled();
    await app.close();
  });

  it("fails closed when query and body project bindings disagree", async () => {
    const projectMembership = checker([goal.projectId]);
    const createGoal = vi.fn(fakeService().createGoal);
    const app = buildServer({ goalService: fakeService({ createGoal }), authenticator: authenticated(), projectMembership });
    const otherProject = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f99";
    const response = await app.inject({
      method: "POST", url: `/v1/goals?projectId=${goal.projectId}`,
      headers: { authorization: "Bearer test-secret", "idempotency-key": "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f09" },
      payload: { projectId: otherProject },
    });
    expect(response.statusCode).toBe(400);
    expect(projectMembership.assertProjectMembership).not.toHaveBeenCalled();
    expect(createGoal).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects a transition and a critical action for a project the operator is not a member of", async () => {
    const projectMembership = checker([]);
    const app = buildServer({ goalService: fakeService(), authenticator: authenticated(), projectMembership });
    const transition = await app.inject({
      method: "POST", url: `/v1/goals/${goal.goalId}/transitions`,
      headers: { authorization: "Bearer test-secret", "idempotency-key": "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f09" },
      payload: { projectId: goal.projectId, expectedVersion: 1, to: "ready_for_confirmation" },
    });
    expect(transition.statusCode).toBe(403);
    const pauseGoal = vi.fn(fakeService().pauseGoal);
    const pauseApp = buildServer({ goalService: fakeService({ pauseGoal }), authenticator: authenticated(), projectMembership });
    const pause = await pauseApp.inject({
      method: "POST", url: `/v1/goals/${goal.goalId}/pause`,
      headers: { authorization: "Bearer test-secret", "idempotency-key": "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f10" },
      payload: { projectId: goal.projectId, expectedVersion: 1 },
    });
    expect(pause.statusCode).toBe(403);
    expect(pauseGoal).not.toHaveBeenCalled();
    await pauseApp.close();
    await app.close();
  });

  it("requires project binding on every derived Goal read and checks membership before the read service", async () => {
    const projectMembership = checker([]);
    const app = buildServer({ goalService: fakeService(), authenticator: authenticated(), readStateService: state, projectMembership });
    const missing = await app.inject({ method: "GET", url: `/v1/goals/${goal.goalId}/metronome-challenges`, headers: { authorization: "Bearer test-secret" } });
    expect(missing.statusCode).toBe(400);
    expect(projectMembership.assertProjectMembership).not.toHaveBeenCalled();
    const forbidden = await app.inject({ method: "GET", url: `/v1/goals/${goal.goalId}/metronome-challenges?projectId=${goal.projectId}`, headers: { authorization: "Bearer test-secret" } });
    expect(forbidden.statusCode).toBe(403);
    expect(projectMembership.assertProjectMembership).toHaveBeenCalledWith(operator.operatorId, goal.projectId);
    await app.close();
  });

  it("skips the membership check entirely when no checker is supplied, matching prior behavior", async () => {
    const app = buildAuthenticatedServer(fakeService());
    const response = await app.inject({
      method: "POST", url: "/v1/goals",
      headers: { authorization: "Bearer test-secret", "idempotency-key": "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f0a" },
      payload: { projectId: goal.projectId },
    });
    expect(response.statusCode).toBe(201);
    await app.close();
  });
});


describe("Goal control routes", () => {
  it("requires auth, validates project-scoped input, and dispatches each narrow operation", async () => {
    const operations = {
      pauseGoal: vi.fn(async () => ({ ...goal, state: "pausing" as const, version: 2 })),
      stopGoal: vi.fn(async () => ({ ...goal, state: "stopping" as const, version: 2 })),
      resumeGoal: vi.fn(async () => ({ ...goal, state: "resuming" as const, version: 2 })),
      emergencyStopGoal: vi.fn(async () => ({ ...goal, state: "stopped" as const, version: 2 })),
    };
    const app = buildServer({ goalService: fakeService(operations), authenticator: authenticated() });
    const headers = { authorization: "Bearer test-secret", "content-type": "application/json" };
    for (const [path, operation] of [["pause", operations.pauseGoal], ["stop", operations.stopGoal], ["resume", operations.resumeGoal], ["emergency-stop", operations.emergencyStopGoal]] as const) {
      const commandId = `018f3c9b-7e71-7b44-ae23-3b5d4e8c9f${path === "pause" ? "01" : path === "stop" ? "02" : path === "resume" ? "03" : "04"}`;
      const response = await app.inject({
        method: "POST",
        url: `/v1/goals/${goal.goalId}/${path}`,
        headers: { ...headers, "idempotency-key": commandId },
        payload: { projectId: goal.projectId, expectedVersion: 1 },
      });
      expect(response.statusCode).toBe(200);
      expect(operation).toHaveBeenCalledWith(goal.goalId, { projectId: goal.projectId, expectedVersion: 1 }, commandId, operator);
    }
    await app.close();
  });
});
