import { z } from "zod";

export const StableApiErrorCodeSchema = z.enum([
  "validation_error",
  "version_conflict",
  "invalid_transition",
  "goal_not_found",
  "stale_lease",
  "lease_unavailable",
  "command_id_reused",
  "durable_store_unavailable",
  "authentication_required",
  "authentication_unavailable",
  "credential_forbidden",
  "critical_action_denied",
  "authority_denied",
  "critical_action_requires_approval",
  "critical_action_approval_forbidden",
  "routing_shortfall",
  "head_activation_cycle",
  "head_activation_conflict",
  "council_not_found",
  "council_conflict",
  "council_briefs_sealed",
  "department_plan_not_found",
  "department_plan_conflict",
  "mission_bundle_not_found",
  "mission_bundle_conflict",
  "worker_not_found",
  "worker_conflict",
  "git_integration_not_found",
  "git_integration_conflict",
  "certification_not_found",
  "certification_conflict",
  "metronome_not_found",
  "metronome_conflict",
  "encore_not_found",
  "encore_conflict",
  "project_access_forbidden",
  "task_contract_not_found",
  "task_contract_conflict",
  "task_contract_version_conflict",
  "exact_confirmation_required",
  "task_contract_integrity_error",
  "discord_signal_rejected",
  "worker_capacity_exceeded",
  "worker_message_rejected",
  "conversation_not_found",
  "conversation_conflict",
  "conversation_unavailable",
  "model_not_allowed",
  "provider_unavailable",
  "account_login_session_unknown",
  "capability_unauthorized",
  "replay_conflict",
  "channel_not_found",
  "channel_conflict",
  "channel_closed",
]);
const RoutingShortfallApiSchema = z
  .object({
    pressure: z.number().finite().min(0).max(200),
    pressureBand: z.enum(["low", "medium", "high", "critical"]),
    decisionLayer: z.enum(["automatic progress", "Department Head", "Encore Council", "user"]),
    rejected: z.array(z.object({ candidateRef: z.string().min(1), reason: z.string().min(1) }).strict()),
  })
  .strict();

export const StableApiErrorSchema = z
  .object({
    error: z
      .object({
        code: StableApiErrorCodeSchema,
        message: z.string().min(1),
        detail: z.string().min(1).max(512).optional(),
        routing: RoutingShortfallApiSchema.optional(),
      })
      .strict(),
  })
  .strict();
export type StableApiError = z.infer<typeof StableApiErrorSchema>;

/** Exact decimal PostgreSQL bigint text. It deliberately never accepts a JS number. */
