import { CHANNEL_SELECTORS, type ApiClient, type ChannelRead } from "@maestro/api-client";
import type { SidebarSection } from "./sidebar.js";

export const MAX_SIDEBAR_CHANNELS = 8;
export const CHANNEL_REFRESH_ROW_ID = "channel:refresh";

/**
 * Department-to-group taxonomy, mirroring domain PERMANENT_DEPARTMENTS
 * (frozen standing taxonomy). Local on purpose: importing @maestro/domain
 * would add a cli package edge for one lookup. Unknown scopes park in the
 * top block so they stay visible instead of vanishing.
 */
const DEPARTMENT_GROUP: Record<string, string> = {
  product: "product",
  design: "product",
  engineering: "tech",
  security: "tech",
  infrastructure: "tech",
  research: "intelligence",
  "data-analysis": "intelligence",
  quality: "assurance",
  "safety-compliance": "assurance",
  operations: "operations",
};

const GROUP_TITLE: Record<string, string> = {
  encore: "encore",
  product: "product group",
  tech: "tech group",
  intelligence: "intelligence group",
  assurance: "assurance group",
  operations: "operations group",
};

/** Mockup order: ungrouped org rows first, then encore, then department groups. */
const GROUP_ORDER = ["top", "encore", "product", "tech", "intelligence", "assurance", "operations"];
const TOP_TITLE = "channels";

interface ChannelBlock {
  title: string;
  reads: ChannelRead[];
}

function blockKey(read: ChannelRead): string {
  if (read.channel.kind === "encore") return "encore";
  if (read.channel.kind === "department") return DEPARTMENT_GROUP[read.channel.scopeId] ?? "top";
  return "top";
}

/** Non-empty blocks in mockup order, uncapped. Render and resolve share this. */
function groupSidebarChannels(reads: readonly ChannelRead[]): ChannelBlock[] {
  const byKey = new Map<string, ChannelRead[]>();
  for (const read of reads) {
    const key = blockKey(read);
    const list = byKey.get(key) ?? [];
    list.push(read);
    byKey.set(key, list);
  }
  const blocks: ChannelBlock[] = [];
  for (const key of GROUP_ORDER) {
    const list = byKey.get(key);
    if (list !== undefined) blocks.push({ title: key === "top" ? TOP_TITLE : GROUP_TITLE[key]!, reads: list });
  }
  return blocks;
}

/** Blocks filled from the global cap in mockup order; overflow is dropped. */
function layoutChannelBlocks(reads: readonly ChannelRead[]): ChannelBlock[] {
  let remaining = MAX_SIDEBAR_CHANNELS;
  const filled: ChannelBlock[] = [];
  for (const block of groupSidebarChannels(reads)) {
    if (remaining <= 0) break;
    const take = block.reads.slice(0, remaining);
    remaining -= take.length;
    filled.push({ title: block.title, reads: take });
  }
  return filled;
}

/** Stable row identity from server-echoed fields (kind plus scope), never parsed from paint. */
export function channelRowKey(read: ChannelRead): string {
  return `channel:${read.channel.kind}:${read.channel.scopeId}`;
}

function channelRowLabel(read: ChannelRead): string {
  return `${read.channel.displayName} (${read.messages.length})`;
}

/**
 * Goal-scoped roster grouped like the web mockup, plus a manual refresh
 * trailer on the last block. Empty caches and empty groups render nothing;
 * the refresh row sits outside the cap.
 */
export function renderChannelSections(reads: readonly ChannelRead[], focusedId: string | undefined): SidebarSection[] {
  const sections = layoutChannelBlocks(reads).map((block) => ({
    title: block.title,
    rows: block.reads.map((read) => ({
      label: channelRowLabel(read),
      id: channelRowKey(read),
      selectable: true,
      focused: channelRowKey(read) === focusedId,
    })),
  }));
  if (sections.length === 0) return [];
  sections[sections.length - 1]!.rows.push({
    label: "refresh",
    id: CHANNEL_REFRESH_ROW_ID,
    selectable: true,
    focused: focusedId === CHANNEL_REFRESH_ROW_ID,
  });
  return sections;
}

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\[[0-9;]*m/g, "");
}

/** Title comparison without paint or the pane divider. */
function titleText(value: string): string {
  return stripAnsi(value).replace(/┃$/, "").trim();
}

/**
 * Map a click to a channel key or the refresh row. Each block title is
 * located independently in paint order, so blank gap lines between sections
 * never disturb offsets; a missing title fails closed to undefined. A
 * display-name prefix guard keeps truncated rows a no-op (truncation cuts
 * the trailing count first). The divider column is chrome.
 */
export function resolveSidebarChannelClick(
  lines: readonly string[],
  reads: readonly ChannelRead[],
  x: number,
  y: number,
): string | undefined {
  if (!Number.isInteger(y) || y < 0 || y >= lines.length) return undefined;
  const layout = layoutChannelBlocks(reads);
  if (layout.length === 0) return undefined;
  let cursor = 0;
  for (const block of layout) {
    const titleIndex = lines.findIndex((line, index) => index >= cursor && titleText(line) === block.title);
    if (titleIndex === -1) return undefined;
    const rowStart = titleIndex + 1;
    if (y >= rowStart && y < rowStart + block.reads.length) {
      const text = stripAnsi(lines[y] ?? "");
      if (!Number.isInteger(x) || x < 0 || x >= text.length - 1) return undefined;
      const read = block.reads[y - rowStart]!;
      if (!text.includes(read.channel.displayName.slice(0, 8))) return undefined;
      return channelRowKey(read);
    }
    cursor = rowStart + block.reads.length;
  }
  if (y !== cursor) return undefined;
  const text = stripAnsi(lines[y] ?? "");
  if (!Number.isInteger(x) || x < 0 || x >= text.length - 1) return undefined;
  return text.includes("refresh") ? CHANNEL_REFRESH_ROW_ID : undefined;
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
