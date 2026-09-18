import { CHANNEL_SELECTORS, type ApiClient, type ChannelRead } from "@maestro/api-client";
import type { SidebarSection } from "./sidebar.js";

export const MAX_SIDEBAR_CHANNELS = 8;
export const CHANNEL_REFRESH_ROW_ID = "channel:refresh";

/** Stable row identity from server-echoed fields (kind plus scope), never parsed from paint. */
export function channelRowKey(read: ChannelRead): string {
  return `channel:${read.channel.kind}:${read.channel.scopeId}`;
}

function channelRowLabel(read: ChannelRead): string {
  return `${read.channel.displayName} (${read.messages.length})`;
}

/**
 * Goal-scoped roster plus a manual refresh trailer. Hidden while the cache is
 * empty; the refresh row is the only fetch trigger besides goal changes.
 */
export function renderChannelSection(reads: readonly ChannelRead[], focusedId: string | undefined): SidebarSection | undefined {
  if (reads.length === 0) return undefined;
  const visible = reads.slice(0, MAX_SIDEBAR_CHANNELS);
  return {
    title: "channels",
    rows: [
      ...visible.map((read) => ({
        label: channelRowLabel(read),
        id: channelRowKey(read),
        selectable: true,
        focused: channelRowKey(read) === focusedId,
      })),
      { label: "refresh", id: CHANNEL_REFRESH_ROW_ID, selectable: true, focused: focusedId === CHANNEL_REFRESH_ROW_ID },
    ],
  };
}

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\[[0-9;]*m/g, "");
}

/**
 * Map a click to a channel key or the refresh row. Scoped to the channels
 * block by title offset; a display-name prefix guard keeps truncated rows a
 * no-op (truncation cuts the trailing count first).
 */
export function resolveSidebarChannelClick(
  lines: readonly string[],
  reads: readonly ChannelRead[],
  x: number,
  y: number,
): string | undefined {
  if (!Number.isInteger(y) || y < 0 || y >= lines.length) return undefined;
  const titleIndex = lines.findIndex((line) => stripAnsi(line).trim() === "channels");
  if (titleIndex === -1) return undefined;
  const visible = reads.slice(0, MAX_SIDEBAR_CHANNELS);
  const offset = y - titleIndex - 1;
  if (offset < 0 || offset > visible.length) return undefined;
  const text = stripAnsi(lines[y] ?? "");
  if (!Number.isInteger(x) || x < 0 || x >= text.length) return undefined;
  if (offset === visible.length) return text.includes("refresh") ? CHANNEL_REFRESH_ROW_ID : undefined;
  const read = visible[offset]!;
  if (!text.includes(read.channel.displayName.slice(0, 8))) return undefined;
  return channelRowKey(read);
}

export interface SidebarChannelHost {
  readonly submitter: { submit(text: string): void };
  readonly view: { appendWarning(text: string): void };
  readonly sidebarChannels: readonly ChannelRead[];
  readonly refreshSidebarChannels: () => void;
}

/**
 * Single dispatcher for channel activation. Cached-key lookup only: unknown
 * ids (including goal and nav ids) are no-ops, and the read command omits
 * --goal-id so the submit path injects the session goal, like /channel list.
 */
export function activateSidebarChannel(host: SidebarChannelHost, id: string): void {
  if (id === CHANNEL_REFRESH_ROW_ID) {
    host.refreshSidebarChannels();
    return;
  }
  const read = host.sidebarChannels.find((entry) => channelRowKey(entry) === id);
  if (read === undefined) return;
  void host.submitter.submit(`/channel read --channel-kind ${read.channel.kind} --channel-id ${read.channel.scopeId}`);
}

export type SidebarChannelSync = "fetch" | "clear" | "none";

/**
 * Pure render-time tag decision: fetch on goal change or first show, clear
 * when goal-less, quiet otherwise. Unrelated dashboard refreshes keep a
 * matching tag, so they never refire the roster fetch.
 */
export function sidebarChannelSyncAction(tag: string | undefined, goalId: string | undefined): SidebarChannelSync {
  if (goalId === undefined) return tag === undefined ? "none" : "clear";
  return tag === goalId ? "none" : "fetch";
}

export interface SidebarChannelLoad {
  client: Pick<ApiClient, "getChannel">;
  projectId: string;
  goalId: string;
  isCurrent?: () => boolean;
}

/**
 * Goal roster fan-out. Mirrors the /channel list membership rule (fulfilled
 * reads with members) but keeps failure visible: undefined means a newer
 * generation won the race (keep rendering old rows, stay silent), while a
 * throw means every read failed (keep the cache and warn).
 */
export async function loadSidebarChannels(options: SidebarChannelLoad): Promise<ChannelRead[] | undefined> {
  if (options.isCurrent?.() === false) return undefined;
  const results = await Promise.allSettled(
    CHANNEL_SELECTORS.map((selector) => options.client.getChannel(options.goalId, selector, { projectId: options.projectId })),
  );
  if (options.isCurrent?.() === false) return undefined;
  const fulfilled = results
    .filter((result): result is PromiseFulfilledResult<ChannelRead> => result.status === "fulfilled")
    .map((result) => result.value);
  if (fulfilled.length === 0) throw new Error("all channel reads failed");
  return fulfilled.filter((read) => read.members.length > 0);
}
