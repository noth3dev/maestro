import { describe, expect, it } from "vitest";
import {
  DeviceGrantScopeError,
  assertValidDeviceGrantScope,
  deviceGrantRequiresCeoApproval,
} from "./device-grant.js";

const scope = (overrides: Partial<Parameters<typeof assertValidDeviceGrantScope>[0]> = {}) => ({
  actionTypes: ["project.file.read", "project.test.run"],
  projectPaths: ["/repo/project"],
  applications: ["chromium"],
  dataScope: ["project files"],
  networkScope: ["none"],
  ...overrides,
});

describe("device grant scope", () => {
  it("accepts a bounded, explicit scope", () => {
    expect(() => assertValidDeviceGrantScope(scope())).not.toThrow();
  });

  it("rejects an empty or non-string action type list", () => {
    expect(() => assertValidDeviceGrantScope(scope({ actionTypes: [] }))).toThrow(DeviceGrantScopeError);
    expect(() => assertValidDeviceGrantScope(scope({ actionTypes: [42 as unknown as string] }))).toThrow(DeviceGrantScopeError);
  });

  it("rejects an unknown scope field instead of silently widening it", () => {
    expect(() => assertValidDeviceGrantScope({ ...scope(), extra: true } as never)).toThrow(DeviceGrantScopeError);
  });

  it("flags a scope that requires explicit CEO approval when it names a critical action family", () => {
    expect(deviceGrantRequiresCeoApproval(scope())).toBe(false);
    expect(deviceGrantRequiresCeoApproval(scope({ actionTypes: ["project.file.read", "git.push"] }))).toBe(true);
    expect(deviceGrantRequiresCeoApproval(scope({ actionTypes: ["EXTERNAL.SEND"] }))).toBe(true);
    expect(deviceGrantRequiresCeoApproval(scope({ actionTypes: ["permanent delete"] }))).toBe(true);
  });
});
