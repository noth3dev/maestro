import { describe, expect, it } from "vitest";
import { CONCERTMASTER_PERSONA_BASELINE, type PersonaProfile } from "./persona.js";
import { buildWorkerPersonaImprovementCandidate, deriveWorkerProfile, isWorkerPersonaOverlayExpired, type WorkerProfileDerivationInput } from "./worker-profile-derivation.js";

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

  it("adapts worker evidence to the shared two-axis persona candidate schema", () => {
    const candidate = buildWorkerPersonaImprovementCandidate({
      projectId: "11111111-1111-4111-8111-111111111111", goalId: "22222222-2222-4222-8222-222222222222", roleId: "head-security", taskClass: "incident-triage",
      currentProfile: template, proposedProfile: { ...template, caution: 0.84 }, sourceEvidenceIds: ["33333333-3333-4333-8333-333333333333"],
      evidencePattern: "repeated unsafe omission", predictedEffect: "fewer unsafe omissions", expectedMetrics: [{ name: "escaped defects", unit: "count", direction: "decrease" }], protectedMetrics: [{ name: "safety", unit: "pass", minimum: 1 }], scenarioSuite: ["critical-action"], confidence: 0.8, episodeCount: 3, comparableGoalCount: 2,
      rollbackTarget: { candidateId: "44444444-4444-4444-8444-444444444444", version: 1, contentHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    });
    expect(candidate.kind).toBe("persona_axis"); expect(candidate.changes).toHaveLength(1); expect(candidate.scenarioSuiteHash).toHaveLength(64);
  });

  it("expires the temporary overlay without mutating the Head or task template", () => {
    const beforeHead = { ...head }; const beforeTemplate = { ...template };
    const result = deriveWorkerProfile(input());
    expect(isWorkerPersonaOverlayExpired(result, new Date("2026-09-14T23:59:59.999Z"))).toBe(false);
    expect(isWorkerPersonaOverlayExpired(result, new Date("2026-09-15T00:00:00.000Z"))).toBe(true);
    expect(head).toEqual(beforeHead); expect(template).toEqual(beforeTemplate);
  });
});
