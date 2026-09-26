import type { RouteDeps } from "../server-ports.js";

/**
 * Narrow route dependencies per register function. Each route file receives
 * only the services it destructures, so unrelated keys (e.g.
 * `personaInspection` inside workers.ts) are a type error at the boundary.
 * server.ts still assembles and passes the full object; structural typing
 * keeps those call sites compiling untouched.
 */
export type AdminRouteDeps = Pick<RouteDeps, "projectAccess">;
export type CapabilityRouteDeps = Pick<RouteDeps, "capabilityApprovals" | "inbox" | "evidenceCapture" | "personaGoalEvidence">;
export type CatalogRouteDeps = Pick<RouteDeps, "projectDiscovery" | "organizations" | "conversations">;
export type ChannelRouteDeps = Pick<RouteDeps, "channels">;
export type ConversationRouteDeps = Pick<RouteDeps, "pollingScheduler" | "conversations" | "activeStreams" | "maxActiveStreams" | "sessionWorkspace">;
export type CouncilRouteDeps = Pick<RouteDeps, "headParticipations" | "councils" | "departmentPlans" | "missionBundles">;
export type CriticalActionRouteDeps = Pick<RouteDeps, "criticalActions">;
export type DiscordRouteDeps = Pick<RouteDeps, "discordSignal">;
export type EventRouteDeps = Pick<
  RouteDeps,
  "events" | "pollingScheduler" | "activeStreams" | "maxActiveStreams" | "authenticator" | "projectMembership"
>;
export type GitRouteDeps = Pick<RouteDeps, "gitIntegrations">;
export type GoalRouteDeps = Pick<RouteDeps, "goalService" | "orchestrationStatus">;
export type OversightRouteDeps = Pick<RouteDeps, "metronome" | "encore">;
export type PersonaRouteDeps = Pick<RouteDeps, "personaInspection">;
export type ProviderRouteDeps = Pick<
  RouteDeps,
  "providerCredentials" | "accountLoginStore" | "loginOwnerId" | "loginOperationStaleAfterMs"
>;
export type ReadRouteDeps = Pick<RouteDeps, "concertmasterReports" | "readState" | "projections" | "planDecisions">;
export type SettingsRouteDeps = Pick<RouteDeps, "settingsService">;
export type RouterRouteDeps = Pick<RouteDeps, "routerCatalogService">;
export type TaskContractRouteDeps = Pick<RouteDeps, "taskContracts">;
export type WorkerRouteDeps = Pick<RouteDeps, "workers" | "certifications">;

export type OvertureRouteDeps = Pick<RouteDeps, "overture" | "pollingScheduler" | "activeStreams" | "maxActiveStreams">;
