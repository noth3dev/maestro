import { describe, expect, it } from "vitest";
import type { TaskContract } from "@maestro/contracts";
import { draftForPresentation } from "./draft-presentation.js";

const draft = {
  contractId: "contract-1",
  version: 2,
  contentHash: "hash-1",
  launchState: "awaiting_confirmation",
} as TaskContract;

describe("draft presentation projection", () => {
  it("uses the current draft for goal-less content and computes its identity", () => {
    expect(draftForPresentation({ content: "not JSON", goalId: undefined, current: draft, renderedIdentity: undefined })).toEqual({
      draft,
      identity: "contract-1:2:hash-1",
      shouldRender: true,
    });
  });

  it("does not project drafts for Goal-bound conversations", () => {
    expect(draftForPresentation({ content: "not JSON", goalId: "goal-1", current: draft, renderedIdentity: undefined })).toBeUndefined();
  });

  it("keeps the draft state while suppressing an already-rendered identity", () => {
    expect(
      draftForPresentation({ content: "not JSON", goalId: undefined, current: draft, renderedIdentity: "contract-1:2:hash-1" }),
    ).toEqual({ draft, identity: "contract-1:2:hash-1", shouldRender: false });
  });
});
