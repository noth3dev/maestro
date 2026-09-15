import { describe, expect, it } from "vitest";
import { ModelGatewayClientError } from "./model-gateway-client.js";
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
