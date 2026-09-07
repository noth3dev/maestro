import { describe, expect, it } from "vitest";
import { renderEvidencePanel } from "./evidence-panel.js";

describe("evidence panel", () => {
  it("renders an empty state and evidence rows", () => {
    expect(renderEvidencePanel({ kind: "empty" }, 80)).toEqual(["Evidence", "No evidence data."]);
    expect(renderEvidencePanel({ kind: "value", value: [{ id: "e1", kind: "test" }] }, 80)).toEqual(["Evidence", "• e1 · test"]);
  });
});
