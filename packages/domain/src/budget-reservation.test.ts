import { describe, expect, it } from "vitest";
import { allocatableCentsAfterQualityReserve, assertValidBudgetReservationSubstance, InvalidBudgetReservationError } from "./budget-reservation.js";

describe("Budget reservation", () => {
  it("accepts a valid reservation", () => {
    expect(() => assertValidBudgetReservationSubstance({ scope: "goal", amountCents: 10_000, reason: "initial envelope" })).not.toThrow();
  });
  it("rejects an unknown field", () => {
    expect(() => assertValidBudgetReservationSubstance({ scope: "goal", amountCents: 1, reason: "x", extra: 1 })).toThrow(InvalidBudgetReservationError);
  });
  it("rejects a non-positive amount", () => {
    expect(() => assertValidBudgetReservationSubstance({ scope: "goal", amountCents: 0, reason: "x" })).toThrow(InvalidBudgetReservationError);
  });
  it("rejects an invalid scope", () => {
    expect(() => assertValidBudgetReservationSubstance({ scope: "team", amountCents: 1, reason: "x" })).toThrow(InvalidBudgetReservationError);
  });
  it("reserves exactly 10% for quality/recovery", () => {
    expect(allocatableCentsAfterQualityReserve(10_000)).toBe(9_000);
    expect(allocatableCentsAfterQualityReserve(1)).toBe(0);
  });
});
