import {
  ProjectListSchema,
  ProjectCatalogSchema,
  ProjectNameInputSchema,
  ProjectSummarySchema,
  OrganizationReadModelSchema,
  ChannelSelectorSchema,
  ChannelQuerySchema,
  ChannelMessageInputSchema,
  ChannelMessageSchema,
  ChannelReadSchema,
  ProjectionQuerySchema,
  ProjectionReadModelSchema,
  BillingReadModelSchema,
  InboxReadSchema,
  ProjectAccessProvisionInputSchema,
  ProjectAccessProvisionResultSchema,
  UuidSchema,
} from "@maestro/contracts";
import { cryptoRandomUuid } from "../transport.js";
import type { ApiClient } from "../client.js";
import type { MethodContext } from "../context.js";

export function createReadsMethods(
  ctx: MethodContext,
): Pick<
  ApiClient,
  | "getBillingSummary"
  | "listInbox"
  | "listProjects"
  | "listProjectCatalog"
  | "createProject"
  | "renameProject"
  | "getOrganization"
  | "getChannel"
  | "postChannelMessage"
  | "getProjection"
  | "provisionProjectAccess"
> {
  const { request, headers } = ctx;
  return {
    getBillingSummary(projectId) {
      const parsedProjectId = UuidSchema.parse(projectId);
      return request(`v1/billing?${new URLSearchParams({ projectId: parsedProjectId })}`, { headers }, BillingReadModelSchema);
    },
    listInbox(projectId) {
      const parsedProjectId = UuidSchema.parse(projectId);
      return request(`v1/inbox?${new URLSearchParams({ projectId: parsedProjectId })}`, { headers }, InboxReadSchema);
    },
    listProjects() {
      return request("v1/projects", { headers }, ProjectListSchema);
    },
    listProjectCatalog() {
      return request("v1/projects/catalog", { headers }, ProjectCatalogSchema);
    },
    createProject(input, commandId) {
      return request(
        "v1/projects",
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(ProjectNameInputSchema.parse(input)),
        },
        ProjectSummarySchema,
      );
    },
    renameProject(projectId, input) {
      return request(
        `v1/projects/${encodeURIComponent(UuidSchema.parse(projectId))}`,
        { method: "PATCH", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(ProjectNameInputSchema.parse(input)) },
        ProjectSummarySchema,
      );
    },
    getOrganization() {
      return request("v1/organization", { headers }, OrganizationReadModelSchema);
    },
    getChannel(goalId, selector, query) {
      const parsedGoalId = UuidSchema.parse(goalId);
      const parsedSelector = ChannelSelectorSchema.parse(selector);
      const parsedQuery = ChannelQuerySchema.parse(query);
      return request(
        `v1/goals/${encodeURIComponent(parsedGoalId)}/channels/${encodeURIComponent(parsedSelector.kind)}/${encodeURIComponent(parsedSelector.channelId)}?${new URLSearchParams({ projectId: parsedQuery.projectId })}`,
        { headers },
        ChannelReadSchema,
      );
    },
    postChannelMessage(goalId, selector, input, commandId = cryptoRandomUuid()) {
      const parsedGoalId = UuidSchema.parse(goalId);
      const parsedSelector = ChannelSelectorSchema.parse(selector);
      const parsedInput = ChannelMessageInputSchema.parse(input);
      return request(
        `v1/goals/${encodeURIComponent(parsedGoalId)}/channels/${encodeURIComponent(parsedSelector.kind)}/${encodeURIComponent(parsedSelector.channelId)}/messages`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(parsedInput),
        },
        ChannelMessageSchema,
      );
    },
    getProjection(query) {
      const parsed = ProjectionQuerySchema.parse(query);
      const params = new URLSearchParams();
      if (parsed.projectId !== undefined) params.set("projectId", parsed.projectId);
      if (parsed.goalId !== undefined) params.set("goalId", parsed.goalId);
      return request(`v1/projection?${params.toString()}`, { headers }, ProjectionReadModelSchema);
    },

    provisionProjectAccess(input) {
      return request(
        "v1/admin/project-access",
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify(ProjectAccessProvisionInputSchema.parse(input)),
        },
        ProjectAccessProvisionResultSchema,
      );
    },
  };
}
