export class InvalidBudgetReservationError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidBudgetReservationError"; }
}

export type BudgetScope = "goal" | "department" | "mission";

/** The quality/recovery reserve is a fixed fraction of every Goal-level reservation that Departments can never allocate away, per plan/phase2.md's Budget behavior. */
export const QUALITY_RECOVERY_RESERVE_BPS = 1000; // 10.00%

export interface BudgetReservationSubstance {
  readonly scope: BudgetScope;
  readonly amountCents: number;
  readonly reason: string;
}

function positiveInt(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new InvalidBudgetReservationError(`${field} must be a positive safe integer`);
}
function text(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new InvalidBudgetReservationError(`${field} is required`);
}

export function assertValidBudgetReservationSubstance(value: unknown): asserts value is BudgetReservationSubstance {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidBudgetReservationError("Budget reservation substance must be an object");
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!["scope", "amountCents", "reason"].includes(key)) throw new InvalidBudgetReservationError(`Budget reservation substance has unknown field ${key}`);
  if (record.scope !== "goal" && record.scope !== "department" && record.scope !== "mission") throw new InvalidBudgetReservationError("Budget reservation scope must be goal, department, or mission");
  positiveInt(record.amountCents, "Budget reservation amountCents");
  text(record.reason, "Budget reservation reason");
}

/** The maximum a Goal-level reservation may allocate to child (Department) reservations, after protecting the quality/recovery reserve. */
export function allocatableCentsAfterQualityReserve(goalAmountCents: number): number {
  return Math.floor(goalAmountCents * (10_000 - QUALITY_RECOVERY_RESERVE_BPS) / 10_000);
}
