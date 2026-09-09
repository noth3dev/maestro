import { describe, expect, it } from "vitest";
import type { CapabilityGrant, InvocationContext, RoutingSelection } from "@maestro/domain";
import { parseConfig } from "./config.js";
import {
  createNativeAdmissionFromRouting,
  createPinnedNativeAdmission,
  type NativeAdmissionInput,
  type NativeAdmissionSelection,
  type RoutedNativeAdmissionBase,
} from "./native-admission.js";

const baseEnv = {
  DATABASE_URL: "postgresql://localhost/maestro",
  MAESTRO_EVIDENCE_DIR: "/tmp/maestro-evidence",
  MAESTRO_WORKTREE_ROOT: "/tmp/maestro-workspaces",
  MAESTRO_MODEL_ROUTING_MODE: "ensemble",
  MAESTRO_MODEL_ACCOUNT_REFS: "test=test-account",
};
const context: InvocationContext = {
  operatorId: "operator-1",
  projectId: "project-1",
  goalId: "goal-1",
  missionBundleId: "bundle-1",
  policyVersion: "policy-1",
  fencingToken: "7",
};
const grant: Omit<CapabilityGrant, "modelPolicy"> = {
  grantId: "grant-1",
  allowedTools: ["read"],
  allowedSkills: ["coding"],
  pathScope: ["/tmp/project"],
  outboundDataClasses: ["workspace"],
  remaining: { modelTurns: 3, toolCalls: 2, childCalls: 0, outputTokens: 1024, wallTimeMs: 10_000, retryCount: 0 },
};
const base: RoutedNativeAdmissionBase = { context, grant, idempotencyKey: "route-1" };
const selection = (overrides: Partial<RoutingSelection & NativeAdmissionSelection> = {}): NativeAdmissionSelection => ({
  schemaVersion: 1,
  goalRef: "goal-1",
  mode: "ensemble",
  selectedCandidateRef: "candidate-1",
  selectedModelRef: "test/model-a",
  accountBinding: "test-account",
  candidateRefs: ["candidate-1"],
  candidateBindings: [{ candidateRef: "candidate-1", modelRef: "test/model-a", accountBinding: "test-account" }],
  rejected: [],
  pressure: { value: 0, band: "low", decisionLayer: "automatic progress" },
  rationale: "selected by the reviewed selector",
  ...overrides,
});

describe("routed native admission binding", () => {
  it("copies the selector identity into both native policy fields and preserves grant boundaries", () => {
    const config = parseConfig(baseEnv);
    const admission = createNativeAdmissionFromRouting(config, selection(), base);
    expect(admission.context.accountRef).toBe("test-account");
    expect(admission.modelPolicy).toEqual(["test/model-a"]);
    expect(admission.grant.modelPolicy).toEqual(["test/model-a"]);
    expect(admission.grant.allowedTools).toEqual(grant.allowedTools);
    expect(admission.grant.pathScope).toEqual(grant.pathScope);
    expect(admission.grant.remaining).toEqual(grant.remaining);
    expect(admission.idempotencyKey).toBe(base.idempotencyKey);
  });

  it("keeps the explicit pin path on the same identity boundary", () => {
    const config = parseConfig({ ...baseEnv, MAESTRO_MODEL_ROUTING_MODE: "pin", MAESTRO_NATIVE_MODEL: "test/model-a" });
    const input: NativeAdmissionInput = {
      purpose: "head",
      goalId: "goal-1",
      projectId: "project-1",
      departmentId: "coding",
      actorId: "operator-1",
      sessionRef: "operator:operator-1",
      commandId: "command-1",
      fencingToken: "7",
    };
    const admission = createPinnedNativeAdmission(config, input);
    expect(admission.modelPolicy).toEqual(["test/model-a"]);
    expect(admission.grant.modelPolicy).toEqual(["test/model-a"]);
  });

  it("fails closed for non-ensemble, missing-candidate, account, context, and contradictory-policy inputs", () => {
    const config = parseConfig(baseEnv);
    expect(() => createNativeAdmissionFromRouting(config, selection({ mode: "pin" }), base)).toThrow("routing mode");
    expect(() => createNativeAdmissionFromRouting(config, selection({ selectedCandidateRef: "other" }), base)).toThrow("decision set");
    expect(() => createNativeAdmissionFromRouting(config, selection({ accountBinding: "other-account" }), base)).toThrow("account binding");
    expect(() => createNativeAdmissionFromRouting(config, selection({ selectedModelRef: "test/model-b" }), base)).toThrow("model binding");
    expect(() =>
      createNativeAdmissionFromRouting(
        config,
        selection({
          candidateRefs: ["candidate-1", "candidate-2"],
          candidateBindings: [
            { candidateRef: "candidate-1", modelRef: "test/model-a", accountBinding: "test-account" },
            { candidateRef: "candidate-1", modelRef: "test/model-b", accountBinding: "test-account" },
          ],
        }),
        base,
      ),
    ).toThrow("duplicate");
    expect(() => createNativeAdmissionFromRouting(config, selection({ goalRef: "other-goal" }), base)).toThrow("Goal binding");
    const contradictory = { ...base, context: { ...context, accountRef: "other-account" } };
    expect(() => createNativeAdmissionFromRouting(config, selection(), contradictory)).toThrow("context account");
    const withPolicy = { ...base, grant: { ...grant, modelPolicy: ["other/model"] } as never };
    expect(() => createNativeAdmissionFromRouting(config, selection(), withPolicy)).toThrow("base grant");
    const pin = parseConfig({ ...baseEnv, MAESTRO_MODEL_ROUTING_MODE: "pin", MAESTRO_NATIVE_MODEL: "test/model-a" });
    expect(() => createNativeAdmissionFromRouting(pin, selection(), base)).toThrow("routing mode");
  });
});
