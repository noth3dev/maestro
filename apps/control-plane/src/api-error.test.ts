import { describe, expect, it } from "vitest";
import { ModelGatewayClientError } from "./model-gateway-client.js";
import { EnsembleRoutingShortfallError } from "./ensemble-admission.js";
import { mapError } from "./api-error.js";
import { OvertureRunNotFoundError } from "@maestro/persistence";
import { OvertureProviderUnavailableError } from "./overture-role-turn.js";
import { TaskContractOrchestrationUnavailableError } from "./task-contract-service.js";

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
    const mapped = mapError(
      new EnsembleRoutingShortfallError("Ensemble routing shortfall escalated to Encore Council", {
        goalRef: "goal-1",
        projectRef: "project-1",
        routeRef: "worker-1",
        pressure: { pressure: 150, band: "high", decisionLayer: "Encore Council" },
        rejected: [{ candidateRef: "candidate-1", reason: "candidate is unavailable" }],
      }),
    );
    expect(mapped).toEqual({
      status: 409,
      body: {
        error: {
          code: "routing_shortfall",
          message: "Ensemble routing shortfall escalated to Encore Council",
          routing: {
            pressure: 150,
            pressureBand: "high",
            decisionLayer: "Encore Council",
            rejected: [{ candidateRef: "candidate-1", reason: "candidate is unavailable" }],
          },
        },
      },
    });
  });
});

describe("Task Contract launch diagnostics", () => {
  it("maps unavailable Goal orchestration to a stable service-unavailable response", () => {
    expect(mapError(new TaskContractOrchestrationUnavailableError("Task Contract launch orchestration is not configured"))).toEqual({
      status: 503,
      body: { error: { code: "task_contract_orchestration_unavailable", message: "Task Contract launch orchestration is not configured" } },
    });
  });
});

describe("Overture diagnostics", () => {
  it("maps a missing provider binding to an explicit unavailable response", () => {
    expect(mapError(new OvertureProviderUnavailableError("No account is configured for provider anthropic"))).toEqual({
      status: 503,
      body: { error: { code: "provider_unavailable", message: "No account is configured for provider anthropic" } },
    });
  });

  it("does not turn a missing project-scoped run into an internal error", () => {
    expect(mapError(new OvertureRunNotFoundError("Overture run not found"))).toEqual({
      status: 404,
      body: { error: { code: "overture_run_not_found", message: "Overture run not found" } },
    });
  });
});
