import { describe, expect, it } from "vitest";
import { prdProjectName } from "../components/TaskContractActions.js";
import { resolveSelectedProject } from "../projects.js";

describe("project naming and selection", () => {
  it("names a new project after the PRD title", () => {
    expect(prdProjectName("# Newsletter sign-up — PRD\n\n## Goal\nx")).toBe("Newsletter sign-up");
    expect(prdProjectName("# PRD: Homepage\n")).toBe("Homepage");
    expect(prdProjectName("## Goal\nno title")).toBe("New project");
  });

  it("keeps a selected project that exists and falls back to Home", () => {
    const project = (projectId: string) => ({ projectId, name: projectId, kind: "project" as const, createdAt: "", goalCount: 0, activeGoalCount: 0 });
    expect(resolveSelectedProject(undefined, undefined, "home")).toBe("home");
    expect(resolveSelectedProject("p1", undefined, "home")).toBe("p1");
    expect(resolveSelectedProject("p1", [project("home"), project("p1")], "home")).toBe("p1");
    expect(resolveSelectedProject("gone", [project("home")], "home")).toBe("home");
  });
});
