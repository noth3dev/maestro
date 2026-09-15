import { describe, expect, it } from "vitest";
import { abortEventStreamsForSender } from "./event-stream-lifecycle.js";

describe("Electron renderer lifecycle cleanup", () => {
  it("aborts and removes every stream owned by a crashed renderer", () => {
    const owner = {};
    const other = {};
    let removals = 0;
    const active = new Map([
      ["owner-1", { sender: owner, controller: new AbortController(), removeLifecycleListener: () => { removals += 1; } }],
      ["owner-2", { sender: owner, controller: new AbortController(), removeLifecycleListener: () => { removals += 1; } }],
      ["other-1", { sender: other, controller: new AbortController(), removeLifecycleListener: () => { removals += 1; } }],
    ]);
    const ownerSignals = [...active.values()].slice(0, 2).map(({ controller }) => controller.signal);

    abortEventStreamsForSender(active, owner);

    expect(ownerSignals.every((signal) => signal.aborted)).toBe(true);
    expect(removals).toBe(2);
    expect(active.has("owner-1")).toBe(false);
    expect(active.has("owner-2")).toBe(false);
    expect(active.has("other-1")).toBe(true);
  });
});
