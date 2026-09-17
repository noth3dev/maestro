import { z } from "zod";
import { ModelRefSchema, UuidSchema } from "./common.js";

export const WorkerSchema = z
  .object({
    workerId: UuidSchema,
    councilId: UuidSchema,
    departmentId: z.string().min(1),
    planVersion: z.number().int().positive(),
    itemId: z.string().min(1),
    bundleContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    attempt: z.number().int().positive(),
    executionRef: z.string().min(1),
    invocationRef: z.string().min(1),
    status: z.enum(["spawned", "running", "awaiting_repair", "succeeded", "failed", "cancelled", "unknown"]),
    answerText: z.string().nullable(),
    usageTotalTokens: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type Worker = z.infer<typeof WorkerSchema>;
export const QueuedWorkerAdmissionSchema = z
  .object({
    kind: z.literal("queued"),
    queueId: z.string().min(1),
    reason: z.enum(["provider_rate", "spend_cents", "worker_slots"]),
    projectId: UuidSchema,
    goalId: UuidSchema,
    commandId: UuidSchema,
    requirement: z.enum(["low", "medium", "high"]),
    pressure: z.enum(["normal", "elevated", "critical"]),
  })
  .strict();
export type QueuedWorkerAdmission = z.infer<typeof QueuedWorkerAdmissionSchema>;

const WorkerCapabilityJournalEntrySchema = z
  .object({
    journalId: UuidSchema,
    capabilityKind: z.string().min(1),
    projectId: UuidSchema,
    goalId: UuidSchema,
    approvalId: UuidSchema.optional(),
    commandId: UuidSchema.optional(),
    event: z.enum(["approval", "rejection", "safer_alternative", "interruption", "effect_result", "failure"]),
    details: z.record(z.string(), z.unknown()),
    recordedAt: z.string().datetime(),
  })
  .strict();
const WorkerToolEventSchema = z
  .object({
    ref: z.string().min(1),
    kind: z.literal("activity"),
    state: z.enum(["waiting", "writing", "executing"]),
    toolName: z.string().min(1).optional(),
  })
  .strict();
const WorkerToolEventsSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("available"), events: z.array(WorkerToolEventSchema).readonly() }).strict(),
  z.object({ state: z.literal("empty"), events: z.array(z.never()).readonly() }).strict(),
  z.object({ state: z.literal("unavailable"), reason: z.enum(["provider-does-not-expose-tool-events", "snapshot-unavailable"]) }).strict(),
]);
const WorkerIpPythonSessionEventSchema = z
  .object({
    journalId: UuidSchema,
    journalPosition: z.string().regex(/^\d+$/),
    sessionId: z.string().min(1),
    processRef: z.string().min(1),
    projectId: UuidSchema,
    goalId: UuidSchema,
    event: z.enum(["started", "orphaned", "reaped", "completed", "failed", "cancelled", "unknown"]),
    reason: z.string().nullable(),
    processPid: z.number().int().positive().nullable(),
    parentPid: z.number().int().positive().nullable(),
    details: z.record(z.string(), z.unknown()),
    occurredAt: z.string().datetime(),
  })
  .strict();
export const WorkerObservationSchema = WorkerSchema.extend({
  observability: z
    .object({
      stopState: z.enum(["open", "pause_requested", "paused", "stopping", "stopped", "emergency_stopped"]),
      capabilityJournal: z.array(WorkerCapabilityJournalEntrySchema),
      ipythonSessionJournal: z.array(WorkerIpPythonSessionEventSchema),
      toolEvents: WorkerToolEventsSchema,
    })
    .strict(),
}).strict();
export type WorkerObservation = z.infer<typeof WorkerObservationSchema>;
export const WorkerListSchema = z.object({ workers: z.array(WorkerSchema) }).strict();
export type WorkerList = z.infer<typeof WorkerListSchema>;
const TargetPathSchema = z.string().min(1).max(4_096);
export const SpawnWorkerInputSchema = z
  .object({
    projectId: UuidSchema,
    planVersion: z.number().int().positive(),
    itemId: z.string().min(1),
    model: ModelRefSchema.optional(),
    /** Target repository and owned worktree are bound before the provider is admitted. */
    repositoryPath: TargetPathSchema.optional(),
    worktreePath: TargetPathSchema.optional(),
    capacityDemand: z
      .object({
        providerRate: z.number().int().positive(),
        spendCents: z.number().int().positive(),
        workerSlots: z.number().int().positive(),
        requirement: z.enum(["low", "medium", "high"]),
        pressure: z.enum(["normal", "elevated", "critical"]),
        priority: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
  })
  .superRefine((value, context) => {
    if ((value.repositoryPath === undefined) !== (value.worktreePath === undefined))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [value.repositoryPath === undefined ? "repositoryPath" : "worktreePath"],
        message: "repositoryPath and worktreePath must be supplied together",
      });
  })
  .strict();
export type SpawnWorkerInput = z.infer<typeof SpawnWorkerInputSchema>;
export const WorkerActionInputSchema = z.object({ projectId: UuidSchema }).strict();
export type WorkerActionInput = z.infer<typeof WorkerActionInputSchema>;
export const WorkerMessageInputSchema = z.object({ projectId: UuidSchema, message: z.string().trim().min(1).max(32_000) }).strict();
export type WorkerMessageInput = z.infer<typeof WorkerMessageInputSchema>;
