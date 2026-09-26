import { describe, expect, it } from "vitest";
import { crewIdentity, messageTime } from "./crew-identity.js";

describe("crew identity", () => {
  it("gives every speaker a distinct avatar", () => {
    const speakers = [
      crewIdentity("operator"),
      crewIdentity("concertmaster"),
      ...["conversation-lead", "architecture-analyst", "external-research-scout", "security-evaluator", "design-mock-specialist", "task-editor"].map((role) =>
        crewIdentity("overture", role),
      ),
    ];
    expect(new Set(speakers.map((speaker) => speaker.avatar)).size).toBe(speakers.length);
    expect(new Set(speakers.map((speaker) => speaker.initials)).size).toBe(speakers.length);
    expect(crewIdentity("overture", "design-mock-specialist")).toEqual({ name: "design specialist", initials: "DS", avatar: "av-grad-design" });
  });

  it("falls back for unknown roles and bad timestamps", () => {
    expect(crewIdentity("overture", "new-role")).toMatchObject({ name: "new-role", initials: "NE" });
    expect(messageTime("not a date")).toBe("");
    expect(messageTime("2026-09-26T10:04:00.000Z")).toMatch(/^\d{2}:\d{2}$/);
  });
});
