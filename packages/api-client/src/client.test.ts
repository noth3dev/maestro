import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "./index.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const commandId = "33333333-3333-4333-8333-333333333333";

describe("createApiClient", () => {
  it("sends authenticated idempotent create commands and parses the result", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ goalId, projectId, state: "draft", version: 0 }), { status: 201 }));
    const client = createApiClient({ baseUrl: "https://maestro.test/", token: "top-secret", fetch });

    await expect(client.createGoal({ projectId }, commandId)).resolves.toEqual({ goalId, projectId, state: "draft", version: 0 });
    expect(fetch).toHaveBeenCalledWith("https://maestro.test/v1/goals", expect.objectContaining({
      method: "POST",
      headers: { authorization: "Bearer top-secret", "content-type": "application/json", "idempotency-key": commandId },
      body: JSON.stringify({ projectId }),
    }));
  });

  it("preserves stable API errors without exposing the bearer token", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "version_conflict", message: "Version changed" } }), { status: 409 }));
    const client = createApiClient({ baseUrl: "https://maestro.test", token: "top-secret", fetch });

    await expect(client.transitionGoal(goalId, { projectId, expectedVersion: 0, to: "active" }, commandId)).rejects.toMatchObject<ApiError>({ name: "ApiError", status: 409, code: "version_conflict", message: "Version changed" });
    try { await client.transitionGoal(goalId, { projectId, expectedVersion: 0, to: "active" }, commandId); } catch (error) {
      expect(String(error)).not.toContain("top-secret");
    }
  });

  it("encodes goal queries and validates paged events", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ events: [], nextCursor: "7" }), { status: 200 }));
    const client = createApiClient({ baseUrl: "https://maestro.test/api", token: "secret", fetch });

    await expect(client.listEvents({ projectId, after: "7" })).resolves.toEqual({ events: [], nextCursor: "7" });
    expect(fetch).toHaveBeenCalledWith(`https://maestro.test/api/v1/events?projectId=${projectId}&after=7`, expect.objectContaining({ headers: { authorization: "Bearer secret" } }));
  });
});

it("reads all four goal state resources with typed methods", async () => {
 const bodies=[{challenges:[]},{rounds:[]},{certifications:[]},{reportId:goalId,goalId,success:true,blockers:[],ceoRequest:"",whatChanged:"",userVisibleBehaviorPassed:true,participatingDepartments:[],keyDecisions:[],dissent:[],independentValidation:[],costCents:0,budgetCents:0,incidents:[],knownLimitations:[],criticalActionAwaitingApproval:false,evidenceBundleId:goalId}];
 const fetch=vi.fn().mockImplementation(async()=>new Response(JSON.stringify(bodies.shift()),{status:200})); const c=createApiClient({baseUrl:"https://maestro.test",token:"t",fetch});
 await expect(c.listMetronomeChallenges(goalId)).resolves.toEqual({challenges:[]}); await expect(c.listEncoreCouncilRounds(goalId)).resolves.toEqual({rounds:[]}); await expect(c.listCertifications(goalId)).resolves.toEqual({certifications:[]}); await expect(c.getConcertmasterReport(goalId)).resolves.toMatchObject({success:true});
});
