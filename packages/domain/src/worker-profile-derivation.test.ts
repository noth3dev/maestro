import { describe, expect, it } from "vitest";
import { CONCERTMASTER_PERSONA_BASELINE, type PersonaProfile } from "./persona.js";
import { deriveWorkerProfile, isWorkerPersonaOverlayExpired, type WorkerProfileDerivationInput } from "./worker-profile-derivation.js";

const template: PersonaProfile = Object.freeze({ ...CONCERTMASTER_PERSONA_BASELINE, caution: 0.80, realism: 0.80, initiative: 0.80 });
const head: PersonaProfile = Object.freeze({ ...template, caution: 0.86, realism: 0.88, initiative: 0.87 });
const input = (overrides: Partial<WorkerProfileDerivationInput> = {}): WorkerProfileDerivationInput => ({
  roleId: "head-security", taskClass: "incident-triage", taskClassTemplate: template, headProfile: head,
  missionOverlay: { caution: 0.02, realism: 0.04, initiative: 0.03 }, missionOverlayExpiresAt: "2026-09-15T00:00:00.000Z",
  assignmentRef: "mission-bundle-1", ...overrides,
});

describe("bounded worker persona derivation", () => {
  it("derives from the task-class template with no more than 0.15 per-axis delta", () => {
    const result = deriveWorkerProfile(input());
    expect(result.profile.caution).toBeCloseTo(0.88);
    for (const axis of Object.keys(result.profile) as (keyof PersonaProfile)[]) expect(Math.abs(result.profile[axis] - template[axis])).toBeLessThanOrEqual(0.15);
    expect(result.profile).not.toEqual(head);
  });

  it("rejects a role-floor violation instead of weakening Security caution", () => {
    expect(() => deriveWorkerProfile(input({ missionOverlay: { caution: -0.1 }, roleFloors: { caution: 0.78 } }))).toThrow(/floor/);
    expect(deriveWorkerProfile(input({ missionOverlay: { caution: -0.04 }, roleFloors: { caution: 0.78 } })).profile.caution).toBeGreaterThanOrEqual(0.75);
  });

  it("explains the three largest deltas against the assignment bundle", () => {
    const result = deriveWorkerProfile(input());
    expect(result.explanations).toHaveLength(3);
    expect(result.explanations.every((item) => item.assignmentRef === "mission-bundle-1")).toBe(true);
    expect(result.explanations[0]!.absoluteDelta).toBeGreaterThanOrEqual(result.explanations[1]!.absoluteDelta);
  });

  it("expires the temporary overlay without mutating the Head or task template", () => {
    const beforeHead = { ...head }; const beforeTemplate = { ...template };
    const result = deriveWorkerProfile(input());
    expect(isWorkerPersonaOverlayExpired(result, new Date("2026-09-14T23:59:59.999Z"))).toBe(false);
    expect(isWorkerPersonaOverlayExpired(result, new Date("2026-09-15T00:00:00.000Z"))).toBe(true);
    expect(head).toEqual(beforeHead); expect(template).toEqual(beforeTemplate);
  });
});
