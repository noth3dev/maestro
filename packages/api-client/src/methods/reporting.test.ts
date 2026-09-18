import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "../index.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";

const bundle = { bundleId: "77777777-7777-4777-8777-777777777777", goalId, hash: "a".repeat(64), content: { goalId, assembledAt: "2030-01-01T00:00:00.000Z" } };
const certifications = { certifications: [] };
const report = { reportId: "88888888-8888-4888-8888-888888888888", goalId, success: true, blockers: [], ceoRequest: "Ship", whatChanged: "A safe change", userVisibleBehaviorPassed: true, participatingDepartments: [], keyDecisions: [], dissent: [], independentValidation: [], costCents: 0, budgetCents: 10, incidents: [], knownLimitations: [], criticalActionAwaitingApproval: false, evidenceBundleId: bundle.bundleId };

function clientFor(fetch: ReturnType<typeof vi.fn>) {
  return createApiClient({ baseUrl: "https://maestro.test", token: "top-secret", fetch });
}

describe("evidence dump client", () => {
  it("fetches bundle, certifications, and report sequentially as one artifact", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(bundle), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(certifications), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(report), { status: 200 }));
    const client = clientFor(fetch);
    await expect(client.getEvidenceDump(goalId, { projectId })).resolves.toEqual({ bundle, certifications, report });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenNthCalledWith(1, `https://maestro.test/v1/goals/${goalId}/evidence-bundle?projectId=${projectId}`, expect.objectContaining({}));
    expect(fetch).toHaveBeenNthCalledWith(2, `https://maestro.test/v1/goals/${goalId}/certifications?projectId=${projectId}`, expect.objectContaining({}));
    expect(fetch).toHaveBeenNthCalledWith(3, `https://maestro.test/v1/goals/${goalId}/concertmaster-report?projectId=${projectId}`, expect.objectContaining({}));
  });

  it("fails closed when the report points at a different bundle", async () => {
    const other = { ...report, evidenceBundleId: "99999999-9999-4999-8999-999999999999" };
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(bundle), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(certifications), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(other), { status: 200 }));
    const client = clientFor(fetch);
    await expect(client.getEvidenceDump(goalId, { projectId })).rejects.toThrow("identity mismatch");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("propagates the first failing call without further requests", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    const client = clientFor(fetch);
    await expect(client.getEvidenceDump(goalId, { projectId })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
