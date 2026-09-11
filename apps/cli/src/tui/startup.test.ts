import { describe, expect, it } from "vitest";
import { shouldAutoBootstrapLocal } from "./startup.js";

describe("shouldAutoBootstrapLocal", () => {
  it("allows local startup when no endpoint or token is configured", () => {
    expect(shouldAutoBootstrapLocal({})).toBe(true);
  });

  it("does not auto-start when an endpoint or token is configured", () => {
    expect(shouldAutoBootstrapLocal({ MAESTRO_API_URL: "http://127.0.0.1:4310" })).toBe(false);
    expect(shouldAutoBootstrapLocal({ MAESTRO_API_TOKEN: "token" })).toBe(false);
  });

  it("honors the explicit disable switch", () => {
    expect(shouldAutoBootstrapLocal({ MAESTRO_DISABLE_LOCAL_AUTOSTART: "true" })).toBe(false);
  });
});
