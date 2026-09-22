import { describe, expect, it, vi } from "vitest";
import type { CertifyWorkerInput, DepartmentAcceptance, GoalIntegrationRevision, IntegrationCommit } from "@maestro/contracts";
import {
  acceptWorkerAfterIntegration,
  advanceWorkerIntegrationFromRevision,
  captureEvidence,
  certifyConditionalWorkerAfterAcceptance,
  certifyWorkerAfterAcceptance,
  createGoalIntegrationBranch,
  createWorkerWorktree,
  freezeGoalIntegrationRevisionFromBranch,
  getEvidenceBundle,
  getEvidenceDump,
  getGitIntegrationState,
  listCertifications,
  type IntegrationApi,
} from "./integration-data.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const workerId = "33333333-3333-4333-8333-333333333333";
const commandId = "44444444-4444-4444-8444-444444444444";
const revision: GoalIntegrationRevision = {
  revisionId: "55555555-5555-4555-8555-555555555555",
  revisionNumber: 3,
  goalId,
  repositoryPath: "/repo/product",
  branchName: "maestro/goal/hero",
  baseRevision: "a".repeat(40),
  commitSha: "b".repeat(40),
};

function fakeApi(overrides: Partial<IntegrationApi> = {}): Partial<IntegrationApi> {
  return {
    createGoalIntegrationBranch: vi
      .fn()
      .mockResolvedValue({ goalId, repositoryPath: "/repo/product", branchName: "maestro/goal/hero", baseRevision: "a".repeat(40) }),
    createWorkerWorktree: vi
      .fn()
      .mockResolvedValue({
        workerId,
        repositoryPath: "/repo/product",
        worktreePath: "/tmp/worker",
        branchName: "maestro/worker/hero",
        baseBranchName: "maestro/goal/hero",
      }),
    advanceWorkerIntegration: vi
      .fn()
      .mockResolvedValue({ workerId, commitSha: "c".repeat(40), message: "integrated", evidenceReferences: ["evidence-1"] }),
    ...overrides,
  };
}

describe("Git integration identity", () => {
  it("creates the Goal branch with the selected Goal and trusted project scope", async () => {
    const api = fakeApi() as unknown as IntegrationApi;
    await createGoalIntegrationBranch(
      api,
      goalId,
      { projectId, repositoryPath: "/repo/product", branchName: "maestro/goal/hero", baseRevision: "a".repeat(40) },
      commandId,
    );
    expect(api.createGoalIntegrationBranch).toHaveBeenCalledWith(
      goalId,
      { projectId, repositoryPath: "/repo/product", branchName: "maestro/goal/hero", baseRevision: "a".repeat(40) },
      commandId,
    );
  });

  it("creates a Worker worktree using the real Worker identity", async () => {
    const api = fakeApi() as unknown as IntegrationApi;
    await createWorkerWorktree(api, workerId, { projectId, worktreePath: "/tmp/worker", repositoryPath: "/repo/product" }, commandId);
    expect(api.createWorkerWorktree).toHaveBeenCalledWith(
      workerId,
      { projectId, worktreePath: "/tmp/worker", repositoryPath: "/repo/product" },
      commandId,
    );
  });

  it("refuses to advance integration without the server's current revision", async () => {
    const api = fakeApi() as unknown as IntegrationApi;
    await expect(
      advanceWorkerIntegrationFromRevision(
        api,
        workerId,
        projectId,
        undefined,
        { message: "integrate", evidenceReferences: ["evidence-1"] },
        commandId,
      ),
    ).rejects.toThrow("current integration revision");
    expect(api.advanceWorkerIntegration).not.toHaveBeenCalled();
    await advanceWorkerIntegrationFromRevision(
      api,
      workerId,
      projectId,
      revision,
      { message: "integrate", evidenceReferences: ["evidence-1"] },
      commandId,
    );
    expect(api.advanceWorkerIntegration).toHaveBeenCalledWith(
      workerId,
      { projectId, message: "integrate", evidenceReferences: ["evidence-1"] },
      commandId,
    );
  });
});

describe("Git integration review gates", () => {
  const acceptance: DepartmentAcceptance = {
    acceptanceId: "66666666-6666-4666-8666-666666666666",
    workerId,
    commitSha: "c".repeat(40),
    reason: "matches contract",
    acceptedBy: "engineering",
  };
  const integrationCommit: IntegrationCommit = {
    workerId,
    commitSha: "c".repeat(40),
    message: "integrated",
    evidenceReferences: ["evidence-1"],
  };
  const substance: CertifyWorkerInput["substance"] = { verdict: "passed", findings: [], testEvidenceIds: ["evidence-1"] };

  function integrationApi(overrides: Partial<IntegrationApi> = {}): IntegrationApi {
    return {
      ...fakeApi(),
      createDepartmentBranch: vi.fn(),
      freezeGoalIntegrationRevision: vi.fn().mockResolvedValue(revision),
      getGitIntegrationState: vi.fn(),
      acceptWorker: vi.fn().mockResolvedValue(acceptance),
      certifyWorker: vi.fn().mockResolvedValue({}),
      certifyConditionalWorker: vi.fn().mockResolvedValue({}),
      captureEvidence: vi.fn(),
      getEvidenceBundle: vi.fn(),
      getEvidenceDump: vi.fn(),
      listCertifications: vi.fn(),
      ...overrides,
    } as unknown as IntegrationApi;
  }

  it("refuses to freeze a revision before a real integration branch exists", async () => {
    const api = integrationApi();
    await expect(freezeGoalIntegrationRevisionFromBranch(api, goalId, false, { projectId }, commandId)).rejects.toThrow(
      "integration branch is required",
    );
    expect(api.freezeGoalIntegrationRevision).not.toHaveBeenCalled();
    await expect(freezeGoalIntegrationRevisionFromBranch(api, goalId, true, { projectId }, commandId)).resolves.toEqual(revision);
    expect(api.freezeGoalIntegrationRevision).toHaveBeenCalledWith(goalId, { projectId }, commandId);
  });

  it("refuses to accept a Worker without a real integration commit or its evidence", async () => {
    const api = integrationApi();
    await expect(acceptWorkerAfterIntegration(api, workerId, undefined, { projectId, reason: "ok" }, commandId)).rejects.toThrow(
      "integration commit is required",
    );
    await expect(
      acceptWorkerAfterIntegration(api, workerId, { ...integrationCommit, evidenceReferences: [] }, { projectId, reason: "ok" }, commandId),
    ).rejects.toThrow("no evidence references");
    await expect(
      acceptWorkerAfterIntegration(api, "99999999-9999-4999-8999-999999999999", integrationCommit, { projectId, reason: "ok" }, commandId),
    ).rejects.toThrow("does not match the selected Worker");
    expect(api.acceptWorker).not.toHaveBeenCalled();
    await expect(acceptWorkerAfterIntegration(api, workerId, integrationCommit, { projectId, reason: "ok" }, commandId)).resolves.toEqual(
      acceptance,
    );
    expect(api.acceptWorker).toHaveBeenCalledWith(workerId, { projectId, reason: "ok" }, commandId);
  });

  it("refuses to certify a Worker before the department has accepted it", async () => {
    const api = integrationApi();
    const input: CertifyWorkerInput = { projectId, certifyingDepartmentId: "engineering", substance };
    await expect(certifyWorkerAfterAcceptance(api, workerId, undefined, input, commandId)).rejects.toThrow("acceptance is required");
    await expect(certifyWorkerAfterAcceptance(api, "99999999-9999-4999-8999-999999999999", acceptance, input, commandId)).rejects.toThrow(
      "does not match the selected Worker",
    );
    expect(api.certifyWorker).not.toHaveBeenCalled();
    await certifyWorkerAfterAcceptance(api, workerId, acceptance, input, commandId);
    expect(api.certifyWorker).toHaveBeenCalledWith(workerId, input, commandId);
  });

  it("refuses conditional certification before the department has accepted the Worker", async () => {
    const api = integrationApi();
    const input: CertifyWorkerInput = { projectId, certifyingDepartmentId: "security", substance };
    await expect(certifyConditionalWorkerAfterAcceptance(api, workerId, undefined, "security", input, commandId)).rejects.toThrow(
      "acceptance is required",
    );
    await expect(
      certifyConditionalWorkerAfterAcceptance(api, "99999999-9999-4999-8999-999999999999", acceptance, "security", input, commandId),
    ).rejects.toThrow("does not match the selected Worker");
    expect(api.certifyConditionalWorker).not.toHaveBeenCalled();
    await certifyConditionalWorkerAfterAcceptance(api, workerId, acceptance, "security", input, commandId);
    expect(api.certifyConditionalWorker).toHaveBeenCalledWith(workerId, "security", input, commandId);
  });

  it("reads Git state, evidence, and certifications through the real API surface only", async () => {
    const api = integrationApi();
    await getGitIntegrationState(api, goalId, { projectId });
    expect(api.getGitIntegrationState).toHaveBeenCalledWith(goalId, { projectId });
    await listCertifications(api, goalId, { projectId });
    expect(api.listCertifications).toHaveBeenCalledWith(goalId, { projectId });
    await getEvidenceBundle(api, goalId, { projectId });
    expect(api.getEvidenceBundle).toHaveBeenCalledWith(goalId, { projectId });
    await getEvidenceDump(api, goalId, { projectId });
    expect(api.getEvidenceDump).toHaveBeenCalledWith(goalId, { projectId });
    await captureEvidence(api, goalId, {
      projectId,
      correlationId: commandId,
      commandId,
      kind: "test-result",
      mediaType: "text/plain",
      contentBase64: "dGVzdA==",
    });
    expect(api.captureEvidence).toHaveBeenCalledWith(goalId, {
      projectId,
      correlationId: commandId,
      commandId,
      kind: "test-result",
      mediaType: "text/plain",
      contentBase64: "dGVzdA==",
    });
  });
});
