import { describe, expect, it } from "vitest";
import { bootstrapProgressText } from "./bootstrap-status.js";

describe("bootstrapProgressText", () => {
  it("names the active bootstrap step when the event has no message", () => {
    expect(bootstrapProgressText({ phase: "starting", step: { step: "migrations", status: "started" } })).toBe("running database migrations…");
  });

  it("preserves a real bootstrap message", () => {
    expect(bootstrapProgressText({ phase: "starting", step: { step: "control-plane-up", status: "failed", message: "Control Plane binary was not found" } })).toBe("Control Plane binary was not found");
  });

  it("shows the startup fallback before the first step arrives", () => {
    expect(bootstrapProgressText({ phase: "starting" })).toBe("preparing the local Control Plane…");
  });

  it("uses the current locale's step labels when provided", () => {
    expect(bootstrapProgressText(
      { phase: "starting", step: { step: "docker-check", status: "started" } },
      "starting…",
      { "docker-check": "Docker 사용 가능 여부 확인 중…" },
    )).toBe("Docker 사용 가능 여부 확인 중…");
  });

  it("announces localized starting and completed text for known steps", () => {
    const stepLabels = { "postgres-ready": "로컬 데이터베이스 시작 중…" };
    const completedStepLabels = { "postgres-ready": "로컬 데이터베이스가 준비되었습니다." };
    expect(bootstrapProgressText(
      { phase: "starting", step: { step: "postgres-ready", status: "started", message: "Starting database" } },
      "starting…",
      stepLabels,
      completedStepLabels,
    )).toBe("로컬 데이터베이스 시작 중…");
    expect(bootstrapProgressText(
      { phase: "starting", step: { step: "postgres-ready", status: "completed", message: "Embedded database is ready" } },
      "starting…",
      stepLabels,
      completedStepLabels,
    )).toBe("로컬 데이터베이스가 준비되었습니다.");
  });
});
