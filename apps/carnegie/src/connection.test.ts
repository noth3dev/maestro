import { describe, expect, it } from "vitest";
import { readConnectionState } from "./connection.js";

describe("readConnectionState", () => {
  it("keeps showing bootstrap progress when the stale saved config cannot be read", async () => {
    const state = await readConnectionState({
      config: {
        get: async () => {
          throw new Error("Stored control-plane token is unavailable");
        },
        error: async () => undefined,
      },
      bootstrap: {
        status: async () => ({ phase: "starting" as const }),
      },
    });

    expect(state).toEqual({
      config: undefined,
      setupError: undefined,
      bootstrap: { phase: "starting" },
    });
  });
});
