import { describe, expect, it } from "vitest";
import { renderApprovalDialog } from "./approval-dialog.js";

describe("approval dialog", () => {
  const summary = {
    tier: "Encore Council" as const,
    tierTrigger: "effect" as const,
    pressure: 118,
    pressureBand: "high" as const,
    effects: [
      { classification: "ordinary" as const, action: "project.file.edit", target: "src/server.ts" },
      { classification: "critical" as const, action: "git.remote.push", target: "origin/main", setsTier: true },
    ],
    repetitionScope: "once" as const,
    saferAlternative: "Prepare a patch without applying it.",
    fullAccessMode: "skip_intermediate_approvals" as const,
    action: "git.remote.push",
    target: "origin/main",
    goalId: "goal-1",
    effect: "Push remote changes",
    expiresAt: "2030-01-01T00:00:00.000Z",
  };

  it("names the tier and trigger in both effect- and pressure-driven cases", () => {
    expect(renderApprovalDialog(summary, 100).join("\n")).toContain("Approval required · Encore Council");
    expect(renderApprovalDialog(summary, 100).join("\n")).toContain("Tier set by effect");
    expect(renderApprovalDialog({ ...summary, tierTrigger: "pressure", tier: "user" }, 100).join("\n")).toContain("Tier set by pressure");
  });
  it("lists every effect and marks the tier-setting effect", () => {
    const rendered = renderApprovalDialog(summary, 100).join("\n");
    expect(rendered).toContain("ordinary   project.file.edit   src/server.ts");
    expect(rendered).toContain("→ critical   git.remote.push   origin/main   ← sets the tier");
  });
  it("shows repetition scope and safer alternative before confirmation", () => {
    const rendered = renderApprovalDialog(summary, 100).join("\n");
    expect(rendered).toContain("Scope  [·] once");
    expect(rendered).toContain("Reject: Prepare a patch without applying it.");
  });
  it("still displays a tier-4 prompt in skip-intermediates mode", () => {
    const rendered = renderApprovalDialog({ ...summary, tier: "user", tierTrigger: "effect" }, 100).join("\n");
    expect(rendered).toContain("Tier 4 user approval remains required");
  });
});
