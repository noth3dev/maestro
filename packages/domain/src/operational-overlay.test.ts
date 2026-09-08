import { describe, expect, it } from "vitest";
import {
  OPERATIONAL_OVERLAY_SCHEMA_VERSION,
  OperationalOverlayValidationError,
  assertValidOperationalOverlay,
  snapshotOperationalOverlayForGoal,
  type OperationalObservation,
  type OperationalOverlay,
} from "./operational-overlay.js";

const observation = (overrides: Partial<OperationalObservation> = {}): OperationalObservation => ({
  candidateRef: "candidate-1",
  measuredLatencyMs: 125.5,
  measuredCost: 0.012,
  failureRate: 0.01,
  timeoutRate: 0.02,
  providerErrorRate: 0.005,
  currentAvailability: true,
  accountBinding: "account-1",
  observedAt: "2026-09-08T12:00:00.000Z",
  ...overrides,
});

const overlay = (overrides: Partial<OperationalOverlay> = {}): OperationalOverlay => ({
  schemaVersion: OPERATIONAL_OVERLAY_SCHEMA_VERSION,
  installationRef: "installation-1",
  projectRef: "project-1",
  version: 3,
  observations: [observation()],
  ...overrides,
});

describe("C operational overlay", () => {
  it("accepts only installation/project-scoped operational observations", () => {
    expect(() => assertValidOperationalOverlay(overlay())).not.toThrow();
  });

  it("rejects capability, provider-fact, authority, policy, and model identity fields", () => {
    for (const field of ["reasoning", "capabilities", "providerFacts", "authority", "dataPolicy", "model", "provider", "identity"]) {
      expect(() => assertValidOperationalOverlay({ ...overlay(), [field]: "hostile" })).toThrow(OperationalOverlayValidationError);
    }
    expect(() => assertValidOperationalOverlay({ ...overlay(), observations: [{ ...observation(), model: "provider/model" }] })).toThrow(
      OperationalOverlayValidationError,
    );
  });

  it("rejects malformed measurements and unavailable account bindings", () => {
    expect(() => assertValidOperationalOverlay(overlay({ observations: [observation({ measuredLatencyMs: Number.NaN })] }))).toThrow(
      OperationalOverlayValidationError,
    );
    expect(() => assertValidOperationalOverlay(overlay({ observations: [observation({ measuredLatencyMs: -1 })] }))).toThrow(
      OperationalOverlayValidationError,
    );
    expect(() =>
      assertValidOperationalOverlay(overlay({ observations: [observation({ measuredCost: Number.POSITIVE_INFINITY })] })),
    ).toThrow(OperationalOverlayValidationError);
    expect(() => assertValidOperationalOverlay(overlay({ observations: [observation({ failureRate: 1.01 })] }))).toThrow(
      OperationalOverlayValidationError,
    );
    expect(() => assertValidOperationalOverlay(overlay({ observations: [observation({ timeoutRate: -0.01 })] }))).toThrow(
      OperationalOverlayValidationError,
    );
    expect(() => assertValidOperationalOverlay(overlay({ observations: [observation({ providerErrorRate: Number.NaN })] }))).toThrow(
      OperationalOverlayValidationError,
    );
    expect(() =>
      assertValidOperationalOverlay(overlay({ observations: [observation({ currentAvailability: true, accountBinding: null })] })),
    ).toThrow(OperationalOverlayValidationError);
    expect(() =>
      assertValidOperationalOverlay(overlay({ observations: [observation({ currentAvailability: false, accountBinding: "" })] })),
    ).toThrow(OperationalOverlayValidationError);
  });

  it("rejects duplicate or non-opaque candidate references and hostile timestamps", () => {
    expect(() => assertValidOperationalOverlay(overlay({ observations: [observation(), observation()] }))).toThrow(
      OperationalOverlayValidationError,
    );
    expect(() => assertValidOperationalOverlay(overlay({ observations: [observation({ candidateRef: "openai/gpt-5" })] }))).toThrow(
      OperationalOverlayValidationError,
    );
    expect(() => assertValidOperationalOverlay(overlay({ observations: [observation({ observedAt: "not-a-time" })] }))).toThrow(
      OperationalOverlayValidationError,
    );
    expect(() => assertValidOperationalOverlay(overlay({ observations: [observation({ observedAt: "two\nlines" })] }))).toThrow(
      OperationalOverlayValidationError,
    );
  });

  it("rejects inherited, hidden, symbol, accessor, and sparse hostile values", () => {
    const inherited = Object.create({ provider: "openai" });
    Object.assign(inherited, overlay());
    expect(() => assertValidOperationalOverlay(inherited)).toThrow(OperationalOverlayValidationError);

    const hidden = overlay() as Record<string, unknown>;
    Object.defineProperty(hidden, "authority", { value: "admin", enumerable: false });
    expect(() => assertValidOperationalOverlay(hidden)).toThrow(OperationalOverlayValidationError);

    const symbol = overlay() as Record<string | symbol, unknown>;
    symbol[Symbol("model")] = "provider/model";
    expect(() => assertValidOperationalOverlay(symbol)).toThrow(OperationalOverlayValidationError);

    const accessor = overlay() as Record<string, unknown>;
    Object.defineProperty(accessor, "version", { enumerable: true, get: () => 3 });
    expect(() => assertValidOperationalOverlay(accessor)).toThrow(OperationalOverlayValidationError);

    const sparse = [observation()];
    delete (sparse as unknown[])[0];
    expect(() => assertValidOperationalOverlay(overlay({ observations: sparse as never }))).toThrow(OperationalOverlayValidationError);
  });

  it("keeps installation and project scope in each Goal snapshot", () => {
    expect(() => assertValidOperationalOverlay(overlay({ installationRef: "", projectRef: "project-1" }))).toThrow(
      OperationalOverlayValidationError,
    );
    expect(() => assertValidOperationalOverlay(overlay({ installationRef: "installation-1", projectRef: "" }))).toThrow(
      OperationalOverlayValidationError,
    );

    const projectOne = snapshotOperationalOverlayForGoal(overlay({ projectRef: "project-1" }), "goal-1");
    const projectTwo = snapshotOperationalOverlayForGoal(overlay({ projectRef: "project-2" }), "goal-2");
    expect(projectOne.projectRef).toBe("project-1");
    expect(projectTwo.projectRef).toBe("project-2");
    expect(projectOne).not.toEqual(expect.objectContaining({ model: expect.anything(), provider: expect.anything() }));
  });

  it("creates a pure immutable Goal snapshot that does not share overlay state", () => {
    const source = overlay();
    const snapshot = snapshotOperationalOverlayForGoal(source, "goal-1");

    expect(snapshot).toEqual({
      schemaVersion: OPERATIONAL_OVERLAY_SCHEMA_VERSION,
      installationRef: "installation-1",
      projectRef: "project-1",
      goalRef: "goal-1",
      overlayVersion: 3,
      observations: [observation()],
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.observations)).toBe(true);
    expect(Object.isFrozen(snapshot.observations[0])).toBe(true);

    source.observations[0].measuredLatencyMs = 900;
    expect(snapshot.observations[0].measuredLatencyMs).toBe(125.5);
    expect(() => {
      (snapshot.observations[0] as OperationalObservation).measuredLatencyMs = 2;
    }).toThrow(TypeError);
  });

  it("does not read mutable values twice or create time-dependent output", () => {
    const source = overlay();
    const first = snapshotOperationalOverlayForGoal(source, "goal-1");
    const second = snapshotOperationalOverlayForGoal(source, "goal-1");
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second.observations).not.toBe(first.observations);
  });
});
