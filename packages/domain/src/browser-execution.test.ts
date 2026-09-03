import { describe, expect, it } from "vitest";
import { assertValidBrowserCommandRequest, type BrowserCommandRequest } from "./browser-execution.js";

const command = (overrides: Partial<BrowserCommandRequest> = {}): BrowserCommandRequest => ({
  commandId: "command-1",
  actorId: "worker-1",
  action: "navigate",
  target: "https://example.com/page",
  policyVersion: 1,
  budgetEffectCents: 0,
  controlEpoch: "1",
  ...overrides,
});

describe("browser command validation", () => {
  it("accepts a valid navigate command", () => {
    expect(() => assertValidBrowserCommandRequest(command())).not.toThrow();
  });

  it("rejects an unknown action", () => {
    expect(() => assertValidBrowserCommandRequest(command({ action: "eval" as never }))).toThrow();
  });

  it("rejects a navigate target that is not http or https", () => {
    expect(() => assertValidBrowserCommandRequest(command({ target: "file:///etc/passwd" }))).toThrow();
    expect(() => assertValidBrowserCommandRequest(command({ target: "not a url" }))).toThrow();
  });

  it("requires a value for fill and rejects a value on other actions", () => {
    expect(() => assertValidBrowserCommandRequest(command({ action: "fill", target: "#field" }))).toThrow();
    expect(() => assertValidBrowserCommandRequest(command({ action: "fill", target: "#field", value: "hello" }))).not.toThrow();
    expect(() => assertValidBrowserCommandRequest(command({ action: "click", target: "#button", value: "hello" }))).toThrow();
  });

  it("allows screenshot without a target", () => {
    expect(() => assertValidBrowserCommandRequest(command({ action: "screenshot", target: "" }))).not.toThrow();
  });

  it("rejects an oversized target or value", () => {
    expect(() => assertValidBrowserCommandRequest(command({ action: "click", target: "#" + "x".repeat(3000) }))).toThrow();
    expect(() => assertValidBrowserCommandRequest(command({ action: "fill", target: "#field", value: "x".repeat(5000) }))).toThrow();
  });
});
