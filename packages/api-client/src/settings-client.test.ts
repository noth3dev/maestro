import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./index.js";

describe("settings client provider schema", () => {
  it("parses provider status through the contract and rejects malformed rows", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ providerId: "openai", connected: true, authModes: ["api-key"] }]), { status: 200 }));
    const client = createApiClient({ baseUrl: "https://maestro.test", token: "secret", fetch });
    await expect(client.listProviderConnections()).resolves.toEqual([{ providerId: "openai", connected: true, authModes: ["api-key"] }]);
    const malformedFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ providerId: "openai", connected: "yes", authModes: [] }]), { status: 200 }));
    await expect(createApiClient({ baseUrl: "https://maestro.test", token: "secret", fetch: malformedFetch }).listProviderConnections()).rejects.toThrow();
  });
});
