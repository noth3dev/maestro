import { describe, expect, it } from "vitest";
import { renderLuthieryPanel } from "./luthiery-panel.js";

describe("luthiery panel", () => {
  it.each(["skills", "tools"] as const)("reports the dependency-defined unavailable %s registry honestly", (kind) => {
    expect(renderLuthieryPanel({ kind: "unavailable", registry: kind }, 120)).toEqual([
      "Luthiery",
      `${kind} registry unavailable`,
      `The control plane does not durably track ${kind} definitions, tags, certification state, or usage counts yet.`,
    ]);
  });
});
