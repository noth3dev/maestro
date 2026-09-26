import { describe, expect, it } from "vitest";
import { buildFileTree, panelFileKind } from "./panel-files.js";

describe("panel files", () => {
  it("picks the tab kind from the file extension", () => {
    expect(panelFileKind("plan00.md")).toEqual({ kind: "markdown" });
    expect(panelFileKind("design/home.canvas")).toEqual({ kind: "canvas", render: "svg" });
    expect(panelFileKind("design/logo.svg")).toEqual({ kind: "canvas", render: "svg" });
    expect(panelFileKind("design/signup.html")).toEqual({ kind: "canvas", render: "html" });
    expect(panelFileKind("design/hero.PNG")).toEqual({ kind: "canvas", render: "image", mime: "image/png" });
    expect(panelFileKind("src/app.tsx")).toEqual({ kind: "code", language: "tsx" });
    expect(panelFileKind("notes.txt")).toEqual({ kind: "text" });
    expect(panelFileKind(".env")).toEqual({ kind: "text" });
  });

  it("builds a folders-first tree from flat paths", () => {
    expect(buildFileTree(["plan00.md", "research/api.md", "design/home.canvas", "plan01.md"])).toEqual([
      { name: "design", path: "design", children: [{ name: "home.canvas", path: "design/home.canvas" }] },
      { name: "research", path: "research", children: [{ name: "api.md", path: "research/api.md" }] },
      { name: "plan00.md", path: "plan00.md" },
      { name: "plan01.md", path: "plan01.md" },
    ]);
  });
});
