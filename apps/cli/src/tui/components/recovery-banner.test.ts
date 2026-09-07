import { describe, expect, it } from "vitest";
import { renderRecoveryBanner } from "./recovery-banner.js";

describe("recovery banner", () => {
  it("renders attached cursor state linearly", () => {
    expect(renderRecoveryBanner({ kind: "attached", projectId: "project-1", lastEventCursor: "42" }, 80)).toEqual(["Session attached", "Project: project-1 · Event cursor: 42", "TUI exit does not cancel server-owned work."]);
  });
});
