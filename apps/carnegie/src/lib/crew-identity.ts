import type { TimelineAuthor } from "./session-timeline.js";

export type CrewIdentity = {
  /** Display name, e.g. "design specialist". */
  name: string;
  /** Two-letter avatar text. */
  initials: string;
  /** CSS class selecting the avatar gradient. */
  avatar: string;
};

const roles: Record<string, CrewIdentity> = {
  "conversation-lead": { name: "conversation lead", initials: "LD", avatar: "av-grad-lead" },
  "architecture-analyst": { name: "architecture analyst", initials: "AR", avatar: "av-grad-architecture" },
  "external-research-scout": { name: "research scout", initials: "RS", avatar: "av-grad-research" },
  "security-evaluator": { name: "security evaluator", initials: "SE", avatar: "av-grad-security" },
  "design-mock-specialist": { name: "design specialist", initials: "DS", avatar: "av-grad-design" },
  "task-editor": { name: "PRD editor", initials: "PE", avatar: "av-grad-task" },
  "plan-reviewer": { name: "plan reviewer", initials: "PR", avatar: "av-grad-reviewer" },
};

/** Who is speaking in the session chat, with a distinct gradient avatar per crew role. */
export function crewIdentity(author: TimelineAuthor, role?: string): CrewIdentity {
  if (author === "operator") return { name: "you", initials: "U", avatar: "av-grad-operator" };
  if (author === "concertmaster") return { name: "concertmaster", initials: "CM", avatar: "av-grad-concertmaster" };
  if (author === "system") return { name: "system", initials: "!", avatar: "av-grad-system" };
  const known = role === undefined ? undefined : roles[role];
  if (known !== undefined) return known;
  const name = role ?? "overture";
  return { name, initials: name.slice(0, 2).toUpperCase(), avatar: "av-grad-system" };
}

/** Local HH:MM for message headers; empty when the timestamp is unusable. */
export function messageTime(createdAt: string): string {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}
