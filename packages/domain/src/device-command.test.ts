import { describe, expect, it } from "vitest";
import { DeviceCommandResultError, assertValidDeviceCommandResult } from "./device-command.js";

const result = (overrides: Record<string, unknown> = {}) => ({
  commandId: "command-1",
  grantId: "grant-1",
  action: "project.file.read",
  target: "/repo/project/README.md",
  sequence: 1,
  resultSummary: "read 128 bytes",
  executedAt: "2030-01-01T00:00:00.000Z",
  ...overrides,
});

describe("device command result", () => {
  it("accepts a bounded result", () => {
    expect(() => assertValidDeviceCommandResult(result())).not.toThrow();
  });

  it("rejects a non-positive-integer sequence", () => {
    expect(() => assertValidDeviceCommandResult(result({ sequence: 0 }))).toThrow(DeviceCommandResultError);
    expect(() => assertValidDeviceCommandResult(result({ sequence: 1.5 }))).toThrow(DeviceCommandResultError);
    expect(() => assertValidDeviceCommandResult(result({ sequence: -1 }))).toThrow(DeviceCommandResultError);
  });

  it("rejects an oversized result summary", () => {
    expect(() => assertValidDeviceCommandResult(result({ resultSummary: "x".repeat(5000) }))).toThrow(DeviceCommandResultError);
  });

  it("rejects secret-like content in the result summary", () => {
    expect(() => assertValidDeviceCommandResult(result({ resultSummary: "Authorization: Bearer sk-live-abc123" }))).toThrow(DeviceCommandResultError);
  });

  it("rejects an unknown field instead of silently widening the record", () => {
    expect(() => assertValidDeviceCommandResult({ ...result(), extra: true })).toThrow(DeviceCommandResultError);
  });
});
