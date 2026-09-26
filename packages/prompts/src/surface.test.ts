import { describe, expect, it } from "vitest";

describe("prompts surface", () => {
  it("pins the barrel export list", async () => {
    const surface = await import("./index.js");
    expect(Object.keys(surface).sort()).toMatchInlineSnapshot(`
      [
        "CONCERTMASTER_WORKSPACE_NOTE",
        "OVERTURE_CREW_GUIDANCE",
        "OVERTURE_ROLE_BRIEFS",
        "OVERTURE_TRIAGE_SYSTEM_PROMPT",
        "OVERTURE_WORKSPACE_GUIDANCE",
        "encoreReviewerPrompt",
        "headActivationPrompt",
        "maestroSystemPrompt",
        "overtureJoinPrompt",
        "overtureRoleSystemPrompt",
        "overtureRoundSummaryPrompt",
        "overtureTriagePrompt",
        "semanticReviewerPrompt",
      ]
    `);
  });
});
