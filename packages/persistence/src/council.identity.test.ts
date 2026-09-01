import { describe, expect, it } from "vitest";
import { isAuthorizedHeadCouncilActor, toHeadCouncilParticipant } from "./council.js";

describe("Head Council participant identity", () => {
  it("uses HeadRoleId as the participant identity while retaining Department and session", () => {
    expect(toHeadCouncilParticipant({
      headRoleId: "head:product", departmentId: "product", sessionRef: "opaque:product",
    })).toEqual({
      participantId: "head:product", headRoleId: "head:product", departmentId: "product", sessionRef: "opaque:product",
    });
  });

  it("authorizes an actor only when role and captured session both match", () => {
    const participant = toHeadCouncilParticipant({
      headRoleId: "head:product", departmentId: "product", sessionRef: "opaque:product",
    });
    expect(isAuthorizedHeadCouncilActor({ actorId: "head:product", sessionRef: "opaque:product" }, participant)).toBe(true);
    expect(isAuthorizedHeadCouncilActor({ actorId: "product", sessionRef: "opaque:product" }, participant)).toBe(false);
    expect(isAuthorizedHeadCouncilActor({ actorId: "head:product", sessionRef: "opaque:restarted" }, participant)).toBe(false);
  });
});
