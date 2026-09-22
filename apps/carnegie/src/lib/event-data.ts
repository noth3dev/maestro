import type { ApiClient, EventQuery, GoalEvent, GoalEventPage } from "@maestro/api-client";

export type EventApi = Pick<ApiClient, "getChannel" | "postChannelMessage" | "listEvents">;

/** Fetches only the durable event page returned by the Control Plane. */
export async function loadEventPage(api: EventApi, query: EventQuery): Promise<GoalEventPage> {
  return api.listEvents(query);
}

export interface EventFilters {
  readonly goalId?: string;
  readonly eventType?: string;
  readonly afterCursor?: string;
  readonly beforeCursor?: string;
  readonly fromTime?: string;
  readonly toTime?: string;
}

function compareCursor(left: string, right: string): number {
  try {
    const a = BigInt(left);
    const b = BigInt(right);
    return a < b ? -1 : a > b ? 1 : 0;
  } catch {
    return left.localeCompare(right);
  }
}

function isAtOrAfter(value: string, bound: string | undefined): boolean {
  return bound === undefined || bound === "" || compareCursor(value, bound) > 0;
}

function isAtOrBefore(value: string, bound: string | undefined): boolean {
  return bound === undefined || bound === "" || compareCursor(value, bound) <= 0;
}

function isAtOrAfterTime(value: string, bound: string | undefined): boolean {
  if (bound === undefined || bound === "") return true;
  const valueTime = Date.parse(value);
  const boundTime = Date.parse(bound);
  return Number.isNaN(boundTime) || (!Number.isNaN(valueTime) && valueTime >= boundTime);
}

function isAtOrBeforeTime(value: string, bound: string | undefined): boolean {
  if (bound === undefined || bound === "") return true;
  const valueTime = Date.parse(value);
  const boundTime = Date.parse(bound);
  return Number.isNaN(boundTime) || (!Number.isNaN(valueTime) && valueTime <= boundTime);
}

/** Filters already-loaded durable server records. It never creates an event or changes its payload. */
export function filterEvents(events: readonly GoalEvent[], filters: EventFilters = {}): GoalEvent[] {
  return events.filter((event) =>
    (filters.goalId === undefined || filters.goalId === "" || event.goalId === filters.goalId)
    && (filters.eventType === undefined || filters.eventType === "" || event.eventType === filters.eventType)
    && isAtOrAfter(event.cursor, filters.afterCursor)
    && isAtOrBefore(event.cursor, filters.beforeCursor)
    && isAtOrAfterTime(event.occurredAt, filters.fromTime)
    && isAtOrBeforeTime(event.occurredAt, filters.toTime),
  );
}

export interface EventLink {
  readonly label: string;
  readonly view: "channel" | "dashboard" | "evlog" | "inbox" | "git";
}

/** Returns navigation into an existing server-backed Carnegie surface. */
export function eventLinks(event: GoalEvent): EventLink[] {
  const kind = event.eventType.toLowerCase();
  const links: EventLink[] = [];
  if (kind.includes("certif") || kind.includes("evidence")) links.push({ label: "Open Evidence Log", view: "evlog" });
  if (kind.includes("git") || kind.includes("integrat") || kind.includes("commit")) links.push({ label: "Open Git", view: "git" });
  if (kind.includes("approval") || kind.includes("effect") || kind.includes("critical")) links.push({ label: "Open Inbox", view: "inbox" });
  if (kind.includes("worker") || kind.includes("execution") || kind.includes("spawn") || kind.includes("mission")) {
    links.push({ label: "Open Worker progress", view: "channel" });
    links.push({ label: "Open Dashboard", view: "dashboard" });
  }
  if (kind.includes("goal")) links.push({ label: "Open Dashboard", view: "dashboard" });
  return links.filter((link, index) => links.findIndex((candidate) => candidate.view === link.view) === index);
}
