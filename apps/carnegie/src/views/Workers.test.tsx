import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MissionBundle, Worker } from "@maestro/contracts";
import { Workers } from "./Workers.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const workerId = "44444444-4444-4444-8444-444444444444";
const hash = "a".repeat(64);
const worker: Worker = {
  workerId,
  councilId: "33333333-3333-4333-8333-333333333333",
  departmentId: "engineering",
  planVersion: 2,
  itemId: "hero-section",
  bundleContentHash: hash,
  attempt: 1,
  executionRef: "execution-1",
  invocationRef: "invocation-1",
  status: "running",
  answerText: null,
  usageTotalTokens: null,
};
const bundle = {
  councilId: worker.councilId,
  departmentId: worker.departmentId,
  planVersion: worker.planVersion,
  planContentHash: "b".repeat(64),
  itemId: worker.itemId,
  parentRef: "department-plan:engineering:2",
  substance: {} as MissionBundle["substance"],
  contentHash: hash,
} satisfies MissionBundle;

vi.mock("../icons.js", () => ({ Icon: () => null }));

const api = {
  getWorker: vi.fn(),
  observeWorker: vi.fn(),
  sendWorkerMessage: vi.fn(),
  cancelWorker: vi.fn(),
  spawnWorker: vi.fn(),
  listWorkersForGoal: vi.fn(),
  createWorkerWorktree: vi.fn(),
};

describe("Worker progressive disclosure surface", () => {
  it("does not offer execution without a real Mission Bundle", () => {
    const html = renderToStaticMarkup(
      <Workers api={api} projectId={projectId} goalId={goalId} workers={[]} missionBundle={undefined} />,
    );

    expect(html).toContain("No Mission Bundle is available");
    expect(html).not.toContain("Spawn worker");
  });

  it("shows selected Worker scope and the real execution controls", () => {
    const html = renderToStaticMarkup(
      <Workers api={api} projectId={projectId} goalId={goalId} workers={[worker]} missionBundle={bundle} selectedWorkerId={workerId} />,
    );

    expect(html).toContain(workerId);
    expect(html).toContain("engineering");
    expect(html).toContain("hero-section");
    expect(html).toContain("Observe worker");
    expect(html).toContain("Send message");
    expect(html).toContain("Cancel worker");
  });
});
