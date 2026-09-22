import { describe, expect, it, vi } from "vitest";
import type { RouterCatalogRead, RouterConfigInput, RouterConfigValidation } from "@maestro/contracts";
import { buildServer, type GoalService } from "./server.js";
import type { OperatorAuthenticator } from "./server-ports.js";
import type { RouterCatalogService } from "./composition/router-catalog.js";

const operator = { operatorId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f05", credentialId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f06" };
const goalService = {
  createGoal: vi.fn(),
  transitionGoal: vi.fn(),
  pauseGoal: vi.fn(),
  stopGoal: vi.fn(),
  resumeGoal: vi.fn(),
  emergencyStopGoal: vi.fn(),
  getGoal: vi.fn(),
} as unknown as GoalService;
const authenticator: OperatorAuthenticator = { authenticateBearerSecret: async () => ({ outcome: "authenticated", operator }) };
const headers = { authorization: "Bearer test-secret", "content-type": "application/json" };
const catalog: RouterCatalogRead = {
  mode: "ensemble",
  active: true,
  status: "ready",
  poolModelRefs: ["openai/model-a"],
  entries: [
    {
      modelRef: "openai/model-a",
      providerId: "openai",
      modelId: "model-a",
      baseline: { present: true, score: 150 },
      live: { present: true, capabilities: ["text"], authModes: ["api-key"], regions: ["US"] },
      candidate: { present: true, candidateRefs: ["candidate-a"], accountBindings: ["opaque-a"] },
      inUse: true,
      state: "catalog-ready",
    },
  ],
};
const input: RouterConfigInput = { schemaVersion: 1, enabledModelRefs: ["openai/model-a"] };
const validation: RouterConfigValidation = {
  valid: true,
  enabledModelRefs: ["openai/model-a"],
  unknownModelRefs: [],
  changes: [],
};

function appWith(service: RouterCatalogService) {
  return buildServer({ goalService, authenticator, routerCatalogService: service });
}

describe("authenticated router routes", () => {
  it("reads the router catalog for the authenticated operator", async () => {
    const service: RouterCatalogService = {
      get: vi.fn(async () => catalog),
      validate: vi.fn(async () => validation),
      replace: vi.fn(async () => catalog),
    };
    const app = appWith(service);

    const response = await app.inject({ method: "GET", url: "/v1/router/catalog", headers });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(catalog);
    expect(service.get).toHaveBeenCalledWith(operator.operatorId);
    await app.close();
  });

  it("previews config without mutating the operator pool", async () => {
    const service: RouterCatalogService = {
      get: vi.fn(async () => catalog),
      validate: vi.fn(async () => validation),
      replace: vi.fn(async () => catalog),
    };
    const app = appWith(service);

    const response = await app.inject({ method: "POST", url: "/v1/router/config/validate", headers, payload: input });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(validation);
    expect(service.validate).toHaveBeenCalledWith(operator.operatorId, input);
    expect(service.replace).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects malformed config before calling the service", async () => {
    const service: RouterCatalogService = {
      get: vi.fn(async () => catalog),
      validate: vi.fn(async () => validation),
      replace: vi.fn(async () => catalog),
    };
    const app = appWith(service);

    const response = await app.inject({
      method: "POST",
      url: "/v1/router/config/validate",
      headers,
      payload: { schemaVersion: 1, enabledModelRefs: ["bad ref"] },
    });

    expect(response.statusCode).toBe(400);
    expect(service.validate).not.toHaveBeenCalled();
    expect(service.replace).not.toHaveBeenCalled();
    await app.close();
  });

  it("replaces the complete config once for the authenticated operator", async () => {
    const service: RouterCatalogService = {
      get: vi.fn(async () => catalog),
      validate: vi.fn(async () => validation),
      replace: vi.fn(async () => catalog),
    };
    const app = appWith(service);

    const response = await app.inject({ method: "PUT", url: "/v1/router/config", headers, payload: input });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(catalog);
    expect(service.replace).toHaveBeenCalledTimes(1);
    expect(service.replace).toHaveBeenCalledWith(operator.operatorId, input);
    await app.close();
  });

  it("reports the existing durable-store unavailable response when the service is missing", async () => {
    const app = buildServer({ goalService, authenticator });

    const response = await app.inject({ method: "GET", url: "/v1/router/catalog", headers });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: { code: "durable_store_unavailable", message: "Durable store is unavailable" } });
    await app.close();
  });
});
