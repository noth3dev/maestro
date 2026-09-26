import { z } from "zod";
import { PERMANENT_DEPARTMENTS } from "./organization.js";

export const CHANNEL_DEPARTMENT_IDS = Object.freeze(
  PERMANENT_DEPARTMENTS.map((department) => department.departmentId),
) as unknown as [string, ...string[]];
export const ChannelDepartmentIdSchema = z.enum(CHANNEL_DEPARTMENT_IDS);
const OrganizationChannelIdSchema = z.enum(["general", "head-council"]);
const EncoreChannelIdSchema = z.enum(["encore-council", "metronome"]);

/** The single channel taxonomy. Scope is a discriminator, never a free-form label. */
export const ChannelSelectorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("department"), channelId: ChannelDepartmentIdSchema }).strict(),
  z.object({ kind: z.literal("organization"), channelId: OrganizationChannelIdSchema }).strict(),
  z.object({ kind: z.literal("encore"), channelId: EncoreChannelIdSchema }).strict(),
]);
export type ChannelSelector = z.infer<typeof ChannelSelectorSchema>;
export const CHANNEL_SELECTORS: readonly ChannelSelector[] = Object.freeze([
  ...CHANNEL_DEPARTMENT_IDS.map((channelId) => ({ kind: "department" as const, channelId })),
  { kind: "organization" as const, channelId: "general" },
  { kind: "organization" as const, channelId: "head-council" },
  { kind: "encore" as const, channelId: "encore-council" },
  { kind: "encore" as const, channelId: "metronome" },
]);

export const ChannelAuthorSchema = z.object({
  kind: z.enum(["operator", "head", "worker", "role"]),
  id: z.string().trim().min(1),
}).strict();
export type ChannelAuthor = z.infer<typeof ChannelAuthorSchema>;

export const ChannelMessageSchema = z.object({
  messageId: z.uuid(),
  channelId: z.uuid(),
  sequence: z.string().regex(/^(0|[1-9][0-9]*)$/),
  author: ChannelAuthorSchema,
  content: z.string().trim().min(1).max(64_000),
  /** The message this one answers, in the same channel. */
  replyToMessageId: z.uuid().nullable().optional(),
  createdAt: z.iso.datetime(),
}).strict();
export type ChannelMessage = z.infer<typeof ChannelMessageSchema>;

export interface ChannelRoleMember {
  readonly identityId: string;
  readonly identityKind: "head" | "worker" | "role";
  readonly displayName: string;
  readonly departmentId: string | null;
  readonly status: string;
}

export function isChannelSelector(value: unknown): value is ChannelSelector {
  return ChannelSelectorSchema.safeParse(value).success;
}

/** Project role IDs that may post. The server still checks active durable grants. */
export function channelRoleIds(selector: ChannelSelector): readonly string[] {
  if (selector.kind === "department") return ["concertmaster", `head-${selector.channelId}`];
  if (selector.kind === "organization" && selector.channelId === "general") return ["concertmaster"];
  if (selector.kind === "organization") return ["concertmaster", ...CHANNEL_DEPARTMENT_IDS.map((id) => `head-${id}`)];
  if (selector.channelId === "metronome") return ["concertmaster", "encore-metronome"];
  return ["concertmaster", "encore-council-1", "encore-council-2", "encore-council-3"];
}

export function channelScopeKey(selector: ChannelSelector): string {
  return `${selector.kind}:${selector.channelId}`;
}
