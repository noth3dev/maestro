export type HeadParticipationStatus = "starting" | "active" | "sleeping";

/** Goal-scoped state. It deliberately does not extend the permanent Department. */
export interface GoalHeadParticipation {
  readonly goalId: string;
  readonly departmentId: string;
  readonly contractId: string | null;
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
