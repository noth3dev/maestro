import { readFileSync } from "node:fs";

export interface IpPythonParentWatchdog {
  start(): void;
  stop(): void;
  checkNow(): Promise<void>;
}

export interface IpPythonParentWatchdogOptions {
  readonly parentPid: number;
  /** Stable OS identity captured for the expected parent PID; prevents PID reuse. */
  readonly parentIdentity: string;
  readonly intervalMs?: number;
  readonly isAlive?: (parentPid: number) => boolean | Promise<boolean>;
  readonly readIdentity?: (parentPid: number) => string | Promise<string>;
  /** Must terminate the complete owned process group, not only the leader. */
  readonly terminate: (reason: "parent_dead" | "parent_identity_mismatch" | "parent_liveness_unknown") => void | Promise<void>;
}

export function readIpPythonParentIdentity(parentPid: number): string {
  try {
    const stat = readFileSync(`/proc/${parentPid}/stat`, "utf8");
    const commandEnd = stat.lastIndexOf(")");
    const fields =
      commandEnd < 0
        ? []
        : stat
            .slice(commandEnd + 2)
            .trim()
            .split(/\s+/);
    const startTime = fields[19];
    if (startTime === undefined || startTime === "") throw new Error("process start time is unavailable");
    return startTime;
  } catch {
    throw new Error("IPython parent identity is unavailable");
  }
}

function defaultParentIsAlive(parentPid: number): boolean {
  try {
    process.kill(parentPid, 0);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") return false;
    throw error;
  }
}

export function createIpPythonParentWatchdog(options: IpPythonParentWatchdogOptions): IpPythonParentWatchdog {
  if (!Number.isSafeInteger(options.parentPid) || options.parentPid <= 0) throw new Error("IPython parent PID is invalid");
  if (typeof options.parentIdentity !== "string" || options.parentIdentity.trim() === "")
    throw new Error("IPython parent identity is required");
  const intervalMs = options.intervalMs ?? 500;
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) throw new Error("IPython parent watchdog interval is invalid");
  const isAlive = options.isAlive ?? defaultParentIsAlive;
  const readIdentity = options.readIdentity ?? readIpPythonParentIdentity;
  let timer: ReturnType<typeof setInterval> | undefined;
  let triggered = false;
  let checkInFlight = false;
  const stop = () => {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
  const checkNow = async () => {
    if (triggered || checkInFlight) return;
    checkInFlight = true;
    try {
      let alive: boolean;
      try {
        alive = await isAlive(options.parentPid);
      } catch {
        triggered = true;
        stop();
        await options.terminate("parent_liveness_unknown");
        return;
      }
      if (!alive) {
        triggered = true;
        stop();
        await options.terminate("parent_dead");
        return;
      }
      let identity: string;
      try {
        identity = await readIdentity(options.parentPid);
      } catch {
        triggered = true;
        stop();
        await options.terminate("parent_liveness_unknown");
        return;
      }
      if (identity === options.parentIdentity) return;
      triggered = true;
      stop();
      await options.terminate("parent_identity_mismatch");
    } finally {
      checkInFlight = false;
    }
  };
  return {
    start() {
      if (timer === undefined && !triggered) {
        timer = setInterval(() => {
          void checkNow();
        }, intervalMs);
        timer.unref?.();
      }
    },
    stop,
    checkNow,
  };
}
