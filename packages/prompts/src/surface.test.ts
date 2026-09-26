import { describe, expect, it } from "vitest";

describe("prompts surface", () => {
  it("pins the barrel export list", async () => {
    const surface = await import("./index.js");
    expect(Object.keys(surface).sort()).toMatchInlineSnapshot(`
      [
        "CONCERTMASTER_WORKSPACE_NOTE",
        "HEAD_BRIEF_SYSTEM_PROMPT",
        "HEAD_MEETING_SYSTEM_PROMPT",
        "MEETING_CHAIR_SYSTEM_PROMPT",
        "OVERTURE_CREW_GUIDANCE",
        "OVERTURE_ROLE_BRIEFS",
        "OVERTURE_TRIAGE_SYSTEM_PROMPT",
        "OVERTURE_WORKSPACE_GUIDANCE",
        "encoreReviewerPrompt",
        "headBriefPrompt",
        "headMeetingPrompt",
        "headPlanReviewPrompt",
        "maestroSystemPrompt",
        "meetingChairTurnPrompt",
        "meetingPlanPrompt",
        "overtureJoinPrompt",
        "overtureRoleSystemPrompt",
        "overtureRoundSummaryPrompt",
        "overtureTriagePrompt",
        "semanticReviewerPrompt",
      ]
    `);
  });
});
