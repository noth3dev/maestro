import { ApiError } from "@maestro/api-client";
import { describe, expect, it } from "vitest";
import { installMaestroBridge, unwrapBridgeResponse } from "./bridge.js";
import type { MaestroBridge } from "./global.js";

describe("renderer API bridge", () => {
  it("restores API failures as ApiError with status and code", async () => {
    const raw = {
      api: { getEvidenceBundle: async () => ({ ok: false, error: { kind: "api-error", status: 404, code: "not_found", message: "Goal was not found" } }) },
      config: {},
    } as unknown as MaestroBridge;
    const target: { maestroBridge?: MaestroBridge; maestro?: MaestroBridge } = { maestroBridge: raw };
    installMaestroBridge(target);
    const failure = await target.maestro!.api.getEvidenceBundle("goal", { projectId: "project" }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 404, code: "not_found", message: "Goal was not found" });
    expect(target.maestro!.config).toBe(raw.config);
  });

  it("returns successful values and passes non-envelope values through", () => {
    expect(unwrapBridgeResponse({ ok: true, value: [1] })).toEqual([1]);
    expect(unwrapBridgeResponse("plain")).toBe("plain");
    expect(() => unwrapBridgeResponse({ ok: false, error: { kind: "error", message: "boom" } })).toThrow("boom");
  });
});
