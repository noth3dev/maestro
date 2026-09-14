import { describe, expect, it } from "vitest";
import { ReactFlow } from "@xyflow/react";
import { hierarchy } from "d3-hierarchy";

describe("Electron radial renderer dependencies", () => {
  it("loads xyflow and d3-hierarchy through the renderer module graph", () => {
    expect(ReactFlow).toBeDefined();
    expect(hierarchy({ id: "renderer", children: [{ id: "sector" }] }).children).toHaveLength(1);
  });
});
