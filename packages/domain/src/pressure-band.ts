export const PRESSURE_BAND_PRESSURE_MIN = 0 as const;
export const PRESSURE_BAND_PRESSURE_MAX = 200 as const;

export const PRESSURE_BANDS = Object.freeze(["low", "medium", "high", "critical"] as const);
export type PressureBand = (typeof PRESSURE_BANDS)[number];

export type PressureDecisionLayer = "automatic progress" | "Department Head" | "Encore Council" | "user";

export interface PressureBandProjection {
  readonly pressure: number;
  readonly band: PressureBand;
  readonly decisionLayer: PressureDecisionLayer;
}

export class PressureBandValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PressureBandValidationError";
  }
}

/** Validate continuous pressure before projecting its organizational label. */
export function assertValidPressure(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < PRESSURE_BAND_PRESSURE_MIN || value > PRESSURE_BAND_PRESSURE_MAX || (value !== 0 && value < 0.000001)) {
    throw new PressureBandValidationError(
      `Pressure must be a finite number in [${PRESSURE_BAND_PRESSURE_MIN},${PRESSURE_BAND_PRESSURE_MAX}]`,
    );
  }
}

/**
 * Project continuous pressure to an organizational decision label.
 *
 * Bands are labels only. This function does not select models, alter task
 * demand, mutate pressure, or grant authority.
 */
export function classifyPressureBand(pressure: number): PressureBandProjection {
  assertValidPressure(pressure);
  const band: PressureBand = pressure < 50 ? "low" : pressure < 100 ? "medium" : pressure < 150 ? "high" : "critical";
  const decisionLayer: PressureDecisionLayer =
    band === "low" ? "automatic progress" : band === "medium" ? "Department Head" : band === "high" ? "Encore Council" : "user";
  return { pressure, band, decisionLayer };
}
