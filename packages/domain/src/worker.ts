export type WorkerStatus = "spawned" | "running" | "succeeded" | "failed" | "cancelled" | "unknown";

/** Every identity field is derived from the Mission Bundle it fulfills; never caller-supplied. */
export interface Worker {
  readonly workerId: string;
  readonly councilId: string;
  readonly departmentId: string;
  readonly planVersion: number;
  readonly itemId: string;
  readonly bundleContentHash: string;
  readonly attempt: number;
  readonly executionRef: string;
  readonly invocationRef: string;
  readonly status: WorkerStatus;
  readonly answerText: string | null;
  readonly usageTotalTokens: number | null;
}

export class InvalidWorkerTransitionError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidWorkerTransitionError"; }
}

const TERMINAL_STATUSES: readonly WorkerStatus[] = ["succeeded", "failed", "cancelled"];

/** A worker's durable status only ever advances toward a terminal state; once terminal, it is immutable. */
export function assertValidWorkerTransition(current: WorkerStatus, next: WorkerStatus): void {
  if (TERMINAL_STATUSES.includes(current) && next !== current) {
    throw new InvalidWorkerTransitionError(`Worker is already terminal (${current}); cannot transition to ${next}`);
  }
}
