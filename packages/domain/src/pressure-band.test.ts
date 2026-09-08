import { describe, expect, it } from "vitest";
import { PRESSURE_BANDS, PressureBandValidationError, classifyPressureBand, type PressureBand } from "./pressure-band.js";

describe("pressure bands", () => {
  it.each([
    [0, "low"],
    [49.5, "low"],
    [50, "medium"],
    [99.5, "medium"],
    [100, "high"],
    [149.5, "high"],
    [150, "critical"],
    [200, "critical"],
  ] as const)("maps pressure %s to the organizational band %s", (pressure, band) => {
    expect(classifyPressureBand(pressure)).toEqual({ pressure, band, decisionLayer: expectedDecisionLayer(band) });
  });

  it("exposes the four labels without turning them into routing or capability tiers", () => {
    expect(PRESSURE_BANDS).toEqual(["low", "medium", "high", "critical"]);
    expect(classifyPressureBand(100)).not.toHaveProperty("selectedModel");
    expect(classifyPressureBand(100)).not.toHaveProperty("capabilityThreshold");
    expect(classifyPressureBand(100)).not.toHaveProperty("authority");
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0.1, 200.1, "100", null, undefined, true])(
    "rejects invalid pressure %s fail-closed",
    (pressure) => {
      expect(() => classifyPressureBand(pressure)).toThrow(PressureBandValidationError);
    },
  );
});

function expectedDecisionLayer(band: PressureBand): string {
  return (
    {
      low: "automatic progress",
      medium: "Department Head",
      high: "Encore Council",
      critical: "user",
    } as const
  )[band];
}
