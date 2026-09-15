import { describe, expect, it } from "vitest";
import { ModelGatewayClientError } from "./model-gateway-client.js";
import { EnsembleRoutingShortfallError } from "./ensemble-admission.js";
import { mapError } from "./api-error.js";

describe("Control Plane provider diagnostics", () => {
  it("surfaces local Codex spawn detail without changing provider_unavailable", () => {
    expect(
      mapError(
        new ModelGatewayClientError(
          "provider_unavailable",
          503,
          "provider is currently unavailable",
          "local codex executable could not be spawned",
        ),
      ),
    ).toEqual({
      status: 503,
      body: {
        error: {
          code: "provider_unavailable",
          message: "Provider is currently unavailable",
          detail: "local codex executable could not be spawned",
        },
      },
    });
  });
});


describe("Ensemble routing shortfall diagnostics", () => {
  it("preserves the pressure-band authority and exact rejected candidates", () => {
    const mapped = mapError(new EnsembleRoutingShortfallError("Ensemble routing shortfall escalated to Encore Council", {
      goalRef: "goal-1", projectRef: "project-1", routeRef: "worker-1", pressure: { pressure: 150, band: "high", decisionLayer: "Encore Council" },
      rejected: [{ candidateRef: "candidate-1", reason: "candidate is unavailable" }],
    }));
    expect(mapped).toEqual({ status: 409, body: { error: {
      code: "routing_shortfall", message: "Ensemble routing shortfall escalated to Encore Council",
      routing: { pressure: 150, pressureBand: "high", decisionLayer: "Encore Council", rejected: [{ candidateRef: "candidate-1", reason: "candidate is unavailable" }] },
    } } });
  });
});
