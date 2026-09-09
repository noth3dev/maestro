import { describe, expect, it } from "vitest";
import { classifyAction } from "./action-classification.js";

describe("action classification registry", () => {
  it("classifies registered actions and defaults unknown actions to ambiguous", () => {
    expect(classifyAction("project.file.read")).toBe("ordinary");
    expect(classifyAction("project.shell.run")).toBe("ordinary");
    expect(classifyAction("project.environment.change")).toBe("ordinary");
    expect(classifyAction("git.remote.push")).toBe("critical");
    expect(classifyAction("system.policy.bypass")).toBe("forbidden");
    expect(classifyAction("future.action")).toBe("ambiguous");
  });
});
