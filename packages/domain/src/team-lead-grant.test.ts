import { describe, expect, it } from "vitest";
import { assertValidTeamLeadGrantSubstance, InvalidTeamLeadGrantError, type TeamLeadGrantSubstance } from "./team-lead-grant.js";

const substance = (overrides: Partial<TeamLeadGrantSubstance> = {}): TeamLeadGrantSubstance => ({
  reason: "large mission needs parallel scouts", maxHelpers: 2, costCeiling: "20 USD", durationCeiling: "1 day",
  taskScope: "parallel research on subsystems A and B", reportingRequirement: "daily status to Head",
  ...overrides,
});

describe("Team-lead grant", () => {
  it("accepts a valid grant", () => {
    expect(() => assertValidTeamLeadGrantSubstance(substance())).not.toThrow();
  });
  it("rejects an unknown field", () => {
    expect(() => assertValidTeamLeadGrantSubstance({ ...substance(), extra: 1 })).toThrow(InvalidTeamLeadGrantError);
  });
  it("rejects a nonpositive maxHelpers", () => {
    expect(() => assertValidTeamLeadGrantSubstance(substance({ maxHelpers: 0 }))).toThrow(InvalidTeamLeadGrantError);
    expect(() => assertValidTeamLeadGrantSubstance(substance({ maxHelpers: -1 }))).toThrow(InvalidTeamLeadGrantError);
  });
  it("rejects a blank reason", () => {
    expect(() => assertValidTeamLeadGrantSubstance(substance({ reason: "" }))).toThrow(InvalidTeamLeadGrantError);
  });
});
