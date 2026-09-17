import { z } from "zod";
import {
  ChannelAuthorSchema as DomainChannelAuthorSchema,
  ChannelMessageSchema as DomainChannelMessageSchema,
  ChannelSelectorSchema as DomainChannelSelectorSchema,
  CHANNEL_SELECTORS as DomainChannelSelectors,
} from "@maestro/domain";
import { UuidSchema } from "./common.js";
import { GoalStateSchema } from "./goal.js";

/** A Goal-bound channel selector. Standing organization/Encore channels share the same durable schema. */
export const ChannelSelectorSchema = DomainChannelSelectorSchema;
export type ChannelSelector = z.infer<typeof ChannelSelectorSchema>;
export const CHANNEL_SELECTORS = DomainChannelSelectors;
export const ChannelQuerySchema = z.object({ projectId: UuidSchema }).strict();
export type ChannelQuery = z.infer<typeof ChannelQuerySchema>;
export const ChannelMessageInputSchema = z.object({ projectId: UuidSchema, content: z.string().trim().min(1).max(64_000) }).strict();
export type ChannelMessageInput = z.infer<typeof ChannelMessageInputSchema>;
export const ChannelAuthorSchema = DomainChannelAuthorSchema;
export const ChannelMessageSchema = DomainChannelMessageSchema;
export type ChannelMessage = z.infer<typeof ChannelMessageSchema>;
export const ChannelMemberSchema = z
  .object({
    identityId: z.string().min(1),
    identityKind: z.enum(["head", "worker", "role"]),
    displayName: z.string().min(1),
    departmentId: z.string().min(1).nullable(),
    status: z.string().min(1),
  })
  .strict();
export type ChannelMember = z.infer<typeof ChannelMemberSchema>;
export const ChannelSchema = z
  .object({
    channelId: UuidSchema,
    projectId: UuidSchema,
    goalId: UuidSchema,
    state: GoalStateSchema,
    kind: z.enum(["department", "organization", "encore"]),
    scopeId: z.string().min(1),
    displayName: z.string().min(1),
  })
  .strict();
export type Channel = z.infer<typeof ChannelSchema>;
export const ChannelReadSchema = z
  .object({ channel: ChannelSchema, messages: z.array(ChannelMessageSchema), members: z.array(ChannelMemberSchema) })
  .strict();
export type ChannelRead = z.infer<typeof ChannelReadSchema>;
