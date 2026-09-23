import { describe, expect, it } from "vitest";
import { modelRef, resolveDefaultModelRef, sortLiveModels } from "./concertmaster-model.js";

const models = [
  {
    identity: { provider: "openai-codex", id: "gpt-b" },
    capabilities: ["text"],
    authModes: ["managed-subscription"],
    dataPolicy: { allowedDataClasses: ["public"], retention: "provider-policy", trainsOnCustomerData: false, regions: [] },
  },
  {
    identity: { provider: "openai-codex", id: "gpt-a" },
    capabilities: ["text"],
    authModes: ["managed-subscription"],
    dataPolicy: { allowedDataClasses: ["public"], retention: "provider-policy", trainsOnCustomerData: false, regions: [] },
  },
];

describe("Concertmaster model selection", () => {
  it("formats an exact provider/model identity", () => {
    expect(modelRef(models[0])).toBe("openai-codex/gpt-b");
  });

  it("sorts live models by exact identity without mutating the gateway result", () => {
    expect(sortLiveModels(models).map(modelRef)).toEqual(["openai-codex/gpt-a", "openai-codex/gpt-b"]);
    expect(models.map(modelRef)).toEqual(["openai-codex/gpt-b", "openai-codex/gpt-a"]);
  });

  it("preserves a saved model only when it is still live", () => {
    expect(resolveDefaultModelRef(models, "openai-codex/gpt-b")).toBe("openai-codex/gpt-b");
    expect(resolveDefaultModelRef(models, "openai-codex/gpt-missing")).toBe("openai-codex/gpt-a");
    expect(resolveDefaultModelRef([], "openai-codex/gpt-b")).toBeUndefined();
  });
});
