import { describe, expect, it } from "vitest";
import { RouterCatalogReadSchema, RouterConfigInputSchema, RouterConfigValidationSchema } from "./router.js";

describe("Router Catalog contracts", () => {
  it("rejects duplicate model references in operator config", () => {
    expect(RouterConfigInputSchema.safeParse({ schemaVersion: 1, enabledModelRefs: ["provider/model", "provider/model"] }).success).toBe(
      false,
    );
  });

  it("rejects secret-shaped or unknown config fields", () => {
    expect(RouterConfigInputSchema.safeParse({ schemaVersion: 1, enabledModelRefs: ["provider/model"], token: "secret" }).success).toBe(
      false,
    );
  });

  it("rejects malformed exact model identities", () => {
    expect(RouterConfigInputSchema.safeParse({ schemaVersion: 1, enabledModelRefs: ["bad model"] }).success).toBe(false);
    expect(RouterConfigInputSchema.safeParse({ schemaVersion: 1, enabledModelRefs: ["provider/model/extra"] }).success).toBe(false);
  });

  it("accepts the strict catalog and validation response shapes", () => {
    const catalog = {
      mode: "ensemble",
      active: true,
      status: "ready",
      poolModelRefs: ["openai/model-a"],
      entries: [
        {
          modelRef: "openai/model-a",
          providerId: "openai",
          modelId: "model-a",
          baseline: { present: true, score: 140, reviewedAt: "2026-09-22T00:00:00.000Z" },
          live: { present: true, capabilities: ["text"], authModes: ["api-key"], regions: ["US"] },
          candidate: { present: true, candidateRefs: ["candidate-a"], accountBindings: ["opaque-account"] },
          inUse: true,
          state: "catalog-ready",
        },
      ],
    };
    expect(RouterCatalogReadSchema.parse(catalog)).toEqual(catalog);
    expect(
      RouterConfigValidationSchema.parse({
        valid: true,
        enabledModelRefs: ["openai/model-a"],
        unknownModelRefs: [],
        changes: [{ modelRef: "openai/model-a", previousInUse: false, nextInUse: true }],
      }),
    ).toBeTruthy();
  });
});
