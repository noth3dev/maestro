import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Certification, DepartmentAcceptance, EvidenceBundleRead, IntegrationCommit } from "@maestro/contracts";
import { WorkerReview } from "./WorkerReview.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const workerId = "22222222-2222-4222-8222-222222222222";
const goalId = "33333333-3333-4333-8333-333333333333";
const contractId = "44444444-4444-4444-8444-444444444444";

vi.mock("../icons.js", () => ({ Icon: () => null }));

const api = {
  acceptWorker: vi.fn(),
  certifyWorker: vi.fn(),
  certifyConditionalWorker: vi.fn(),
};

const integrationCommit: IntegrationCommit = {
  workerId,
  commitSha: "c".repeat(40),
  message: "integrated hero section",
  evidenceReferences: ["evidence-1"],
};

const acceptance: DepartmentAcceptance = {
  acceptanceId: "55555555-5555-4555-8555-555555555555",
  workerId,
  commitSha: "c".repeat(40),
  reason: "matches contract",
  acceptedBy: "engineering",
};

const evidenceBundle: EvidenceBundleRead = {
  bundleId: "66666666-6666-4666-8666-666666666666",
  goalId,
  content: {},
  hash: "a".repeat(64),
};

const certification: Certification = {
  certificationId: "77777777-7777-4777-8777-777777777777",
  kind: "quality",
  goalId,
  contractId,
  contractVersion: 1,
  contractContentHash: "b".repeat(64),
  integratedCommitSha: "c".repeat(40),
  workerId,
  departmentAcceptanceId: acceptance.acceptanceId,
  integrationRevisionId: "88888888-8888-4888-8888-888888888888",
  verdict: "passed",
  certifiedByDepartment: "engineering",
  producingDepartment: "engineering",
};

describe("Worker review evidence gates", () => {
  it("never offers acceptance without a real integration commit and evidence", () => {
    const html = renderToStaticMarkup(
      <WorkerReview
        api={api}
        projectId={projectId}
        workerId={workerId}
        certifyingDepartmentId="engineering"
        integrationCommit={undefined}
        acceptance={undefined}
        evidenceBundle={undefined}
        certifications={[]}
      />,
    );

    expect(html).toContain("No real integration commit has been produced");
    expect(html).toContain("disabled");
  });

  it("shows the real integration commit and evidence, still disabled before explicit review confirmation", () => {
    const html = renderToStaticMarkup(
      <WorkerReview
        api={api}
        projectId={projectId}
        workerId={workerId}
        certifyingDepartmentId="engineering"
        integrationCommit={integrationCommit}
        acceptance={undefined}
        evidenceBundle={evidenceBundle}
        certifications={[]}
      />,
    );

    expect(html).toContain("integrated hero section");
    expect(html).toContain("evidence-1");
    expect(html).toContain(evidenceBundle.bundleId);
    expect(html).toContain('disabled=""> ');
    expect(html).toContain("Accept worker");
  });

  it("requires a loaded server evidence bundle before acceptance can be enabled", () => {
    const html = renderToStaticMarkup(
      <WorkerReview
        api={api}
        projectId={projectId}
        workerId={workerId}
        certifyingDepartmentId="engineering"
        integrationCommit={integrationCommit}
        acceptance={undefined}
        evidenceBundle={undefined}
        certifications={[]}
      />,
    );

    expect(html).toContain("No evidence bundle loaded yet");
    expect(html).toContain("Acceptance and certification require a server-issued evidence bundle");
    expect(html).toContain("Accept worker");
    expect(html).toContain('disabled=""> ');
  });

  it("never enables certification before the department has accepted the Worker", () => {
    const html = renderToStaticMarkup(
      <WorkerReview
        api={api}
        projectId={projectId}
        workerId={workerId}
        certifyingDepartmentId="engineering"
        integrationCommit={integrationCommit}
        acceptance={undefined}
        evidenceBundle={evidenceBundle}
        certifications={[]}
      />,
    );

    expect(html).toContain('disabled=""> Certify worker');
    expect(html).toContain('disabled=""> Certify conditionally');
  });

  it("shows accepted state and the real certification history once it exists", () => {
    const html = renderToStaticMarkup(
      <WorkerReview
        api={api}
        projectId={projectId}
        workerId={workerId}
        certifyingDepartmentId="engineering"
        integrationCommit={integrationCommit}
        acceptance={acceptance}
        evidenceBundle={evidenceBundle}
        certifications={[certification]}
      />,
    );

    expect(html).toContain("accepted by engineering");
    expect(html).toContain("quality");
    expect(html).toContain("passed");
    expect(html).not.toContain("No real integration commit");
  });

  it("never renders a conditional certification as a passed certification", () => {
    const conditional: Certification = { ...certification, verdict: "blocked", kind: "security" };
    const html = renderToStaticMarkup(
      <WorkerReview
        api={api}
        projectId={projectId}
        workerId={workerId}
        certifyingDepartmentId="security"
        integrationCommit={integrationCommit}
        acceptance={acceptance}
        evidenceBundle={evidenceBundle}
        certifications={[conditional]}
      />,
    );

    expect(html).toContain("blocked");
    expect(html).not.toContain("security · passed");
  });
});
