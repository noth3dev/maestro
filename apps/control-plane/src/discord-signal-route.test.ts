import { describe, expect, it, vi } from "vitest";
import { signDiscordSignal, deriveDiscordIncidentFingerprint, type DiscordSignal } from "@maestro/domain";
import { DiscordPersistenceError } from "@maestro/persistence";
import { buildServer, type DiscordSignalService, type GoalService, type OperatorAuthenticator } from "./server.js";

const operator = { operatorId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f05", credentialId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f06" };
const goal = { goalId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f02", projectId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f01", state: "active" as const, version: 1 };

function authenticated(outcome: "authenticated" | "invalid" = "authenticated"): OperatorAuthenticator {
  return {
    authenticateBearerSecret: async () =>
      outcome === "authenticated" ? { outcome: "authenticated", operator } : { outcome: "invalid" },
  };
}

function fakeGoalService(): GoalService {
  return {
    createGoal: async () => goal,
    transitionGoal: async () => goal,
    pauseGoal: async () => goal,
    stopGoal: async () => goal,
    resumeGoal: async () => goal,
    emergencyStopGoal: async () => ({ ...goal, state: "stopped" }),
    getGoal: async () => goal,
  };
}

function signal(overrides: Partial<DiscordSignal> = {}): DiscordSignal {
  const now = Date.now();
  const value: DiscordSignal = {
    incidentFingerprint: "", firstObservedAt: new Date(now - 2000).toISOString(), lastObservedAt: new Date(now - 1000).toISOString(),
    severity: "warning", confidence: 0.9, affectedComponent: "control-plane", affectedVersion: "1.0.0",
    minimalReproductionEvidence: ["GET /health -> 503"], source: "health-probe", sourceFreshness: new Date(now - 1000).toISOString(),
    deduplicationRelationship: "new", discordHealthState: "healthy", ...overrides,
  };
  return { ...value, incidentFingerprint: deriveDiscordIncidentFingerprint(value) };
}

describe("Discord signal ingestion route", () => {
  it("requires bearer auth before reaching the Discord signal service at all", async () => {
    const record = vi.fn(async () => { throw new Error("must not be called"); });
    const app = buildServer({ goalService: fakeGoalService(), authenticator: authenticated("invalid"), discordSignalService: { record } });

    const envelope = signDiscordSignal(signal(), "shared-secret", "n1", 1);
    const response = await app.inject({ method: "POST", url: "/v1/discord/signals", payload: envelope });

    expect(response.statusCode).toBe(401);
    expect(record).not.toHaveBeenCalled();
    await app.close();
  });

  it("fails closed with 503 when no Discord signal service is configured", async () => {
    const app = buildServer({ goalService: fakeGoalService(), authenticator: authenticated() });
    const envelope = signDiscordSignal(signal(), "shared-secret", "n1", 1);

    const response = await app.inject({
      method: "POST", url: "/v1/discord/signals",
      headers: { authorization: "Bearer test-secret" },
      payload: envelope,
    });

    expect(response.statusCode).toBe(503);
    await app.close();
  });

  it("forwards an authenticated signal to the injected service and returns the stored record", async () => {
    const stored = { ...signal(), signalId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f10", nonce: "n1", sequence: 1, issuedAt: new Date().toISOString(), signature: "sig", receivedAt: new Date().toISOString() };
    const record = vi.fn(async () => stored);
    const discordSignalService: DiscordSignalService = { record };
    const app = buildServer({ goalService: fakeGoalService(), authenticator: authenticated(), discordSignalService });

    const envelope = signDiscordSignal(signal(), "shared-secret", "n1", 1);
    const response = await app.inject({
      method: "POST", url: "/v1/discord/signals",
      headers: { authorization: "Bearer test-secret" },
      payload: envelope,
    });

    expect(response.statusCode).toBe(201);
    expect(record).toHaveBeenCalledWith(envelope);
    expect(response.json()).toMatchObject({ signalId: stored.signalId });
    await app.close();
  });

  it("returns a stable 400 rather than a raw 500 when the signal's own signature/replay check fails", async () => {
    const record = vi.fn(async () => { throw new DiscordPersistenceError("Discord signal was not recorded"); });
    const app = buildServer({ goalService: fakeGoalService(), authenticator: authenticated(), discordSignalService: { record } });

    const envelope = signDiscordSignal(signal(), "shared-secret", "n1", 1);
    const response = await app.inject({
      method: "POST", url: "/v1/discord/signals",
      headers: { authorization: "Bearer test-secret" },
      payload: envelope,
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
