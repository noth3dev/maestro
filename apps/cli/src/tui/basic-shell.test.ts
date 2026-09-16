import { describe, expect, it, vi } from "vitest";
import { executeBasicShellCommand } from "./basic-shell.js";

describe("basic shell command module", () => {
  it("keeps version output at the shell boundary", async () => {
    const write = vi.fn();

    await expect(
      executeBasicShellCommand("version", {
        clearTranscript: vi.fn(),
        stop: vi.fn(),
        getLatestTranscriptText: vi.fn(() => undefined),
        copyToClipboard: vi.fn(async () => undefined),
        write,
        version: "maestro development",
      }),
    ).resolves.toBe(true);

    expect(write).toHaveBeenCalledWith("maestro development");
  });
});
