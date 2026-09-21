import { describe, expect, it } from "vitest";
import { DEFAULT_ZOOM_FACTOR, zoomFactorAfterInput } from "./window-settings.js";

describe("Carnegie window zoom", () => {
  it("starts at a readable default zoom", () => {
    expect(DEFAULT_ZOOM_FACTOR).toBe(1.6);
  });

  it("keeps keyboard zoom behavior and resets to the readable default", () => {
    expect(zoomFactorAfterInput(1.6, "=")).toBeCloseTo(1.7);
    expect(zoomFactorAfterInput(1.6, "+")).toBeCloseTo(1.7);
    expect(zoomFactorAfterInput(1.6, "-")).toBe(1.5);
    expect(zoomFactorAfterInput(0.5, "-")).toBe(0.5);
    expect(zoomFactorAfterInput(2.1, "0")).toBe(1.6);
    expect(zoomFactorAfterInput(1.6, "x")).toBe(1.6);
  });
});
