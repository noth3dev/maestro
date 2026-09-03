/** Provider-neutral command execution inside one task-scoped EnvironmentRecord. */
export type EnvironmentProcessStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "output_limit_exceeded";

export interface EnvironmentCommandRequest {
  readonly commandId: string;
  readonly actorId: string;
  readonly action: string;
  readonly target: string;
  readonly policyVersion: number;
  readonly budgetEffectCents: number;
  readonly controlEpoch: string;
  /** The executable and every argument are separate values. Shell syntax is not accepted. */
  readonly argv: readonly string[];
  readonly cwd: string;
  /** Only these variables are passed to the process; host process.env is never inherited. */
  readonly environment?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly outputCapBytes?: number;
}

export interface EnvironmentProcessResult {
  readonly invocationId: string;
  readonly status: EnvironmentProcessStatus;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly outputTruncated: boolean;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly error?: string;
}

export interface EnvironmentProcessHandle {
  readonly invocationId: string;
  observe(): Promise<EnvironmentProcessResult>;
  cancel(reason?: string): Promise<{ cancelled: boolean }>;
}

/** Adapter boundary. Implementations must bind every command to one environment record. */
export interface EnvironmentExecutionPort {
  start(request: EnvironmentCommandRequest): Promise<EnvironmentProcessHandle>;
}
