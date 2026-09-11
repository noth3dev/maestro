import { describe, expect, it } from "vitest";
import { ModelCatalogEntrySchema, ProviderCredentialLoginInputSchema } from "./provider-credentials.js";

describe("provider credential contracts", () => {
  it("accepts the registered API-key login shape", () => {
    expect(ProviderCredentialLoginInputSchema.parse({ providerId: "openai", authMode: "api-key", secret: "secret" }).providerId).toBe("openai");
  });

  it("rejects an unsupported provider login", () => {
    expect(() => ProviderCredentialLoginInputSchema.parse({ providerId: "google", authMode: "api-key", secret: "secret" })).toThrow();
  });

  it("keeps model catalog metadata validation in the extracted module", () => {
    const value = ModelCatalogEntrySchema.parse({
      identity: { provider: "openai", id: "gpt" },
      capabilities: ["chat"],
      authModes: ["api-key"],
      dataPolicy: { allowedDataClasses: ["workspace"], retention: "provider-policy", trainsOnCustomerData: false, regions: ["us"] },
    });
    expect(value.identity.provider).toBe("openai");
  });
});
