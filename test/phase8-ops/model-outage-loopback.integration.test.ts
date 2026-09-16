import { createServer } from "node:http";
import { createModelGatewayClient } from "../../apps/control-plane/src/model-gateway-client.js";
import { describe, expect, it } from "vitest";

describe("Plan 8 §S6 model outage loopback fixture", () => {
  it("maps a real loopback 503 to provider_unavailable without leaking response-body secrets", async () => {
    const secret = "fixture-provider-secret";
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url ?? "");
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { code: "provider_unavailable", message: "provider is currently unavailable" }, secret }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("loopback fixture did not expose a port");

    try {
      const client = createModelGatewayClient({ baseUrl: `http://127.0.0.1:${address.port}`, token: "fixture-gateway-token" });
      const error = await client.listModels({ operatorId: "fixture-operator" }).catch((reason: unknown) => reason);
      if (!(error instanceof Error)) throw new Error(`expected an Error, received ${JSON.stringify(error)}`);
      expect(error).toMatchObject({ code: "provider_unavailable", status: 503, message: "provider is currently unavailable" });
      expect(error.message).not.toContain(secret);
      expect(requests).toEqual(["/v1/models"]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((reason) => (reason === undefined ? resolve() : reject(reason))));
    }
  });
});
