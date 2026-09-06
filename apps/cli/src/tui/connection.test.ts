import { describe, expect, it } from "vitest";
import { resolveConnection } from "./connection.js";

describe("resolveConnection", () => {
  it("uses explicit API settings when both values exist", async () => {
    await expect(resolveConnection({ MAESTRO_API_URL: "http://127.0.0.1:4310", MAESTRO_API_TOKEN: "secret" })).resolves.toEqual({ kind: "configured", apiUrl: "http://127.0.0.1:4310", token: "secret" });
  });

  it("reports setup required when local prerequisites are absent", async () => {
    await expect(resolveConnection({})).resolves.toEqual({ kind: "setup-required", reason: "Control Plane connection is not configured" });
  });

  it("rejects malformed URLs without exposing the token", async () => {
    await expect(resolveConnection({ MAESTRO_API_URL: "not-a-url", MAESTRO_API_TOKEN: "secret" })).resolves.toEqual({ kind: "setup-required", reason: "MAESTRO_API_URL is not a valid HTTP(S) URL" });
  });

  it("does not accept a URL without a token", async () => {
    await expect(resolveConnection({ MAESTRO_API_URL: "http://127.0.0.1:4310" })).resolves.toMatchObject({ kind: "setup-required" });
  });
});
