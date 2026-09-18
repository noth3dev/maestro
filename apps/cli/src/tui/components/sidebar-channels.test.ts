import { describe, expect, it, vi } from "vitest";
import {
  activateSidebarChannel,
  CHANNEL_REFRESH_ROW_ID,
  channelRowKey,
  loadSidebarChannels,
  MAX_SIDEBAR_CHANNELS,
  renderChannelSection,
  resolveSidebarChannelClick,
  sidebarChannelSyncAction,
} from "./sidebar-channels.js";
import { renderNavSection, renderSidebar, SIDEBAR_WIDTH } from "./sidebar.js";
import { NAV_ROWS } from "./sidebar-nav.js";
import type { ChannelRead } from "@maestro/api-client";

// eslint-disable-next-line no-control-regex
const stripAnsi = (value: string): string => value.replace(/\[[0-9;]*m/g, "");

function message(index: number): ChannelRead["messages"][number] {
  return {
    messageId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    channelId: "00000000-0000-4000-8000-000000000000",
    sequence: `${index + 1}`,
    author: { kind: "operator", id: "operator-1" },
    content: `hello ${index}`,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function read(
  kind: ChannelRead["channel"]["kind"],
  scopeId: string,
  options: { messages?: number; members?: number } = {},
): ChannelRead {
  const messageCount = options.messages ?? 2;
  const memberCount = options.members ?? 1;
  return {
    channel: {
      channelId: "00000000-0000-4000-8000-000000000000",
      projectId: "00000000-0000-4000-8000-000000000001",
      goalId: "00000000-0000-4000-8000-000000000002",
      state: "active",
      kind,
      scopeId,
      displayName: `#${scopeId}`,
    },
    messages: Array.from({ length: messageCount }, (_, index) => message(index)),
    members: Array.from({ length: memberCount }, (_, index) => ({
      identityId: `identity-${index}`,
      identityKind: "head" as const,
      displayName: `Head ${index}`,
      departmentId: "engineering",
      status: "active",
    })),
  };
}

const reads = [read("department", "engineering", { messages: 3 }), read("organization", "general")];

describe("channel row keys", () => {
  it("identifies rows by kind plus scope without parsing paint", () => {
    expect(channelRowKey(reads[0]!)).toBe("channel:department:engineering");
    expect(channelRowKey(reads[1]!)).toBe("channel:organization:general");
    expect(MAX_SIDEBAR_CHANNELS).toBe(8);
    expect(CHANNEL_REFRESH_ROW_ID).toBe("channel:refresh");
  });
});

describe("renderChannelSection", () => {
  it("lists display names with message counts plus a refresh trailer", () => {
    const section = renderChannelSection(reads, undefined);
    expect(section?.title).toBe("channels");
    expect(section?.rows.map((row) => row.label)).toEqual(["#engineering (3)", "#general (2)", "refresh"]);
    expect(section?.rows.map((row) => row.id)).toEqual([
      "channel:department:engineering",
      "channel:organization:general",
      CHANNEL_REFRESH_ROW_ID,
    ]);
    for (const row of section?.rows ?? []) expect(row.selectable).toBe(true);
  });

  it("marks focus without disturbing other rows", () => {
    const section = renderChannelSection(reads, "channel:organization:general");
    expect(section?.rows[0]?.focused).toBe(false);
    expect(section?.rows[1]?.focused).toBe(true);
    expect(section?.rows[2]?.focused).toBe(false);
  });

  it("returns undefined when the cache is empty", () => {
    expect(renderChannelSection([], undefined)).toBeUndefined();
  });

  it("caps rows at the rendered limit with the refresh trailer last", () => {
    const many = Array.from({ length: 12 }, (_, index) => read("department", `dept-${index}`));
    const section = renderChannelSection(many, undefined);
    expect(section?.rows.length).toBe(MAX_SIDEBAR_CHANNELS + 1);
    expect(section?.rows[MAX_SIDEBAR_CHANNELS]).toMatchObject({ label: "refresh", id: CHANNEL_REFRESH_ROW_ID });
  });

  it("keeps rows within the fixed width", () => {
    const section = renderChannelSection([read("department", "safety-compliance", { messages: 123 })], undefined);
    const lines = renderSidebar(SIDEBAR_WIDTH, [section!]);
    for (const line of lines) expect(stripAnsi(line).length).toBeLessThanOrEqual(SIDEBAR_WIDTH);
    expect(stripAnsi(lines.join("\n"))).toContain("#safety-compliance");
  });
});

describe("sidebarChannelSyncAction", () => {
  it("fetches on tag mismatch, clears with no goal, and stays quiet on match", () => {
    expect(sidebarChannelSyncAction(undefined, "goal-1")).toBe("fetch");
    expect(sidebarChannelSyncAction("goal-1", "goal-2")).toBe("fetch");
    expect(sidebarChannelSyncAction("goal-1", "goal-1")).toBe("none");
    expect(sidebarChannelSyncAction("goal-1", undefined)).toBe("clear");
    expect(sidebarChannelSyncAction(undefined, undefined)).toBe("none");
  });
});

describe("resolveSidebarChannelClick", () => {
  function lines() {
    const section = renderChannelSection(reads, undefined);
    return renderSidebar(SIDEBAR_WIDTH, [renderNavSection(NAV_ROWS, undefined), section!]);
  }

  function rowIndex(rendered: readonly string[], fragment: string): number {
    return rendered.findIndex((line) => stripAnsi(line).includes(fragment));
  }

  it("maps channel rows to keys and ignores other sections plus chrome", () => {
    const rendered = lines();
    expect(resolveSidebarChannelClick(rendered, reads, 3, rowIndex(rendered, "#engineering"))).toBe("channel:department:engineering");
    expect(resolveSidebarChannelClick(rendered, reads, 3, rowIndex(rendered, "#general"))).toBe("channel:organization:general");
    expect(resolveSidebarChannelClick(rendered, reads, 3, rowIndex(rendered, "home"))).toBeUndefined();
    expect(resolveSidebarChannelClick(rendered, reads, 3, 0)).toBeUndefined();
    expect(resolveSidebarChannelClick(rendered, reads, 3, -1)).toBeUndefined();
    expect(resolveSidebarChannelClick(rendered, reads, 3, rendered.length)).toBeUndefined();
  });

  it("maps the refresh trailer to the refresh id", () => {
    const rendered = lines();
    expect(resolveSidebarChannelClick(rendered, reads, 3, rowIndex(rendered, "refresh"))).toBe(CHANNEL_REFRESH_ROW_ID);
  });

  it("ignores clicks beyond the rendered text", () => {
    const rendered = lines();
    expect(resolveSidebarChannelClick(rendered, reads, 99, rowIndex(rendered, "#engineering"))).toBeUndefined();
  });

  it("ignores channel rows whose name prefix was truncated away", () => {
    const rendered = lines();
    const target = rowIndex(rendered, "#engineering");
    expect(target).toBeGreaterThanOrEqual(0);
    const truncated = [...rendered];
    truncated[target] = "  …";
    expect(resolveSidebarChannelClick(truncated, reads, 3, target)).toBeUndefined();
  });

  it("never matches a goal name rendered outside the channels block", () => {
    const section = renderChannelSection(reads, undefined);
    const rendered = renderSidebar(SIDEBAR_WIDTH, [
      { title: "status", rows: [{ label: "goal", value: "#engineering launch" }] },
      renderNavSection(NAV_ROWS, undefined),
      section!,
    ]);
    expect(resolveSidebarChannelClick(rendered, reads, 3, rowIndex(rendered, "status") + 1)).toBeUndefined();
  });
});

describe("activateSidebarChannel", () => {
  function host(channels: readonly ChannelRead[]) {
    return {
      submitter: { submit: vi.fn() },
      view: { appendWarning: vi.fn() },
      sidebarChannels: channels,
      refreshSidebarChannels: vi.fn(),
    };
  }

  it("opens the channel view through the read command without a goal flag", () => {
    const h = host(reads);
    activateSidebarChannel(h, "channel:department:engineering");
    expect(h.submitter.submit).toHaveBeenCalledWith("/channel read --channel-kind department --channel-id engineering");
    expect(h.refreshSidebarChannels).not.toHaveBeenCalled();
  });

  it("refreshes the roster on the refresh row instead of submitting", () => {
    const h = host(reads);
    activateSidebarChannel(h, CHANNEL_REFRESH_ROW_ID);
    expect(h.refreshSidebarChannels).toHaveBeenCalledOnce();
    expect(h.submitter.submit).not.toHaveBeenCalled();
  });

  it("ignores ids outside the cache", () => {
    const h = host(reads);
    activateSidebarChannel(h, "channel:department:security");
    expect(h.submitter.submit).not.toHaveBeenCalled();
    expect(h.refreshSidebarChannels).not.toHaveBeenCalled();
  });
});

describe("loadSidebarChannels", () => {
  function client(handler: (selector: { kind: string; channelId: string }) => ChannelRead | undefined) {
    return {
      getChannel: vi.fn(async (_goalId: string, selector: { kind: string; channelId: string }) => {
        const read = handler(selector);
        if (read === undefined) throw new Error(`no channel for ${selector.kind}:${selector.channelId}`);
        return read;
      }),
    };
  }

  it("keeps the fulfilled subset and filters memberless channels", async () => {
    const api = client((selector) => {
      if (selector.channelId === "engineering") return read("department", "engineering", { messages: 3 });
      if (selector.channelId === "general") return read("organization", "general", { members: 0 });
      return undefined;
    });
    const result = await loadSidebarChannels({ client: api as never, projectId: "project-1", goalId: "goal-1" });
    expect(result?.map((entry) => entry.channel.scopeId)).toContain("engineering");
    expect(result?.map((entry) => entry.channel.scopeId)).not.toContain("general");
    expect(api.getChannel.mock.calls.length).toBeGreaterThan(2);
    expect(api.getChannel).toHaveBeenCalledWith("goal-1", expect.objectContaining({ channelId: "engineering" }), { projectId: "project-1" });
  });

  it("throws when every channel read fails so callers keep their cache", async () => {
    const api = client(() => undefined);
    await expect(loadSidebarChannels({ client: api as never, projectId: "project-1", goalId: "goal-1" })).rejects.toThrow();
  });

  it("returns undefined when a newer generation wins the race", async () => {
    const api = client((selector) => read(selector.kind as ChannelRead["channel"]["kind"], selector.channelId));
    let current = true;
    const pending = loadSidebarChannels({ client: api as never, projectId: "project-1", goalId: "goal-1", isCurrent: () => current });
    current = false;
    await expect(pending).resolves.toBeUndefined();
  });
});
