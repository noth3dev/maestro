export type HeadParticipationStatus = "starting" | "active" | "sleeping";

/** The durable identity key for the standing Head assigned to a Department. */
export function canonicalHeadRoleId(departmentId: string): string {
  if (typeof departmentId !== "string" || departmentId.trim() === "") {
    throw new Error("departmentId is required to derive a HeadRoleId");
  }
  return `head:${departmentId.trim()}`;
}

/** Goal-scoped state. It deliberately does not extend the permanent Department. */
export interface GoalHeadParticipation {
  readonly goalId: string;
  readonly departmentId: string;
  /** Stable permanent Head identity. A Head gets a separate participation per Goal. */
  readonly headRoleId: string;
  /** Exact Task Contract identity used to assemble this Goal participation. */
  readonly contractId: string | null;
  /** Goal-scoped context identity; context contents never live in this record. */
  readonly contextId: string | null;
  readonly status: HeadParticipationStatus;
  /** Opaque provider/session handle. It is never prompt or transcript content. */
  readonly activeSessionRef: string | null;
}

export function canActivateHead(status: HeadParticipationStatus): boolean {
  return status === "sleeping";
}

export function markHeadParticipationActive(
  participation: GoalHeadParticipation,
  activeSessionRef: string,
): GoalHeadParticipation {
  if (participation.status !== "starting") throw new Error("Only a starting Head participation can become active");
  if (activeSessionRef === "") throw new Error("An active Head participation needs an opaque session reference");
  return { ...participation, status: "active", activeSessionRef };
}

export function sleepHeadParticipation(participation: GoalHeadParticipation): GoalHeadParticipation {
  if (participation.status !== "active" && participation.status !== "starting") {
    throw new Error("Only an active or starting Head participation can sleep");
  }
  return { ...participation, status: "sleeping", activeSessionRef: null };
}
