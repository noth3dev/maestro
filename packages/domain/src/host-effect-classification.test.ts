import { describe, expect, it } from "vitest";
import { classifyAction } from "@maestro/authority";
import { classifyHostEffects, HostEffectClassificationError } from "./host-effect-classification.js";

describe("host effect classification", () => {
  it("classifies an ordinary file read as automatic progress", () => {
    expect(classifyHostEffects(["project.file.read"], 0)).toMatchObject({ tier: "automatic progress" });
  });

  it("takes the highest effect tier for a mixed block", () => {
    expect(classifyHostEffects(["project.file.edit", "process.shell.run"], 0)).toMatchObject({ tier: "user" });
  });

  it("denies forbidden effects before assigning an approval tier", () => {
    expect(() => classifyHostEffects(["system.policy.bypass"], 0)).toThrow(HostEffectClassificationError);
  });

  it("escalates an unknown action to the user tier", () => {
    expect(classifyHostEffects(["unregistered.effect"], 0)).toMatchObject({ tier: "user" });
  });

  it("combines effect and pressure tiers by max in both directions", () => {
    expect(classifyHostEffects(["project.file.read"], 150)).toMatchObject({ tier: "user" });
    expect(classifyHostEffects(["git.remote.push"], 0)).toMatchObject({ tier: "user" });
  });

  it("does not lower the pressure tier for an empty effect set", () => {
    expect(classifyHostEffects([], 50)).toMatchObject({ tier: "Department Head" });
    expect(classifyHostEffects([], 0)).toMatchObject({ tier: "automatic progress" });
  });

  it("uses the authority registry as the single action vocabulary", () => {
    expect(classifyAction("git.remote.push")).toBe("critical");
    expect(classifyHostEffects(["git.remote.push"], 0)).toMatchObject({ tier: "user" });
  });
});
