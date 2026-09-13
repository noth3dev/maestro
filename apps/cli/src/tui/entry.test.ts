import { describe, expect, it } from "vitest";
import { parseInput } from "./commands/parser.js";
import { createAutomaticProviderSignInGate, shouldOfferAutomaticProviderSignIn } from "./entry.js";

const model = (provider: string, id: string) => ({
  identity: { provider, id },
  capabilities: ["text"],
  authModes: ["api-key" as const],
  dataPolicy: {
    allowedDataClasses: ["public" as const],
    retention: "none" as const,
    trainsOnCustomerData: false,
    regions: ["US"],
  },
});

describe("automatic provider sign-in", () => {
  it("offers sign-in when no model/provider credential is resolvable", () => {
    expect(shouldOfferAutomaticProviderSignIn([], undefined)).toBe(true);
    expect(shouldOfferAutomaticProviderSignIn([model("openai", "gpt-5")], "openai/unknown")).toBe(true);
  });

  it("does not offer sign-in when the session or environment model is available", () => {
    expect(shouldOfferAutomaticProviderSignIn([model("openai", "gpt-5")], "openai/gpt-5")).toBe(false);
  });

  it("claims the automatic offer only once, including after dismissal", () => {
    const gate = createAutomaticProviderSignInGate();
    expect(gate.claim()).toBe(true);
    expect(gate.claim()).toBe(false);
  });

  it("leaves the explicit /login command available", () => {
    expect(parseInput("/login")).toEqual({ kind: "command", name: "login", options: {} });
  });
});
