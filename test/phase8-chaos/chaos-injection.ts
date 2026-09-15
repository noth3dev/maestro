export const CHAOS_BOUNDARIES = [
  "goal.before-commit",
  "council.before-decision-commit",
  "mission-bundle.before-provider-admission",
  "worker.after-provider-spawn",
  "worker.timeout",
  "worker.cancel",
  "worker.late-result",
  "worker.duplicate-reply",
  "effect.before-commit",
  "certification.before-commit",
  "postgres.reconnect",
  "native-runtime.session-loss",
  "git.partial-operation",
  "git.merge-conflict",
  "environment.disconnect",
  "device.disconnect",
  "discord.outage",
  "discord.duplicate",
  "discord.stale",
  "evaluator.before-verdict",
  "rollout.observe",
  "app.reconnect",
  "app.stale-command",
  "evidence.before-write",
] as const;

export type ChaosBoundary = (typeof CHAOS_BOUNDARIES)[number] | (string & {});

export type ChaosFault =
  | { readonly kind: "throw"; readonly error: Error }
  | { readonly kind: "delay"; readonly delayMs: number }
  | { readonly kind: "corrupt"; readonly transform: (value: unknown) => unknown };

export class ChaosInjectedError extends Error {
  readonly boundary: ChaosBoundary;
  constructor(boundary: ChaosBoundary, message = `Chaos fault injected at ${boundary}`) {
    super(message);
    this.name = "ChaosInjectedError";
    this.boundary = boundary;
  }
}

/**
 * Test-only fault injector. It is explicit at each production call boundary,
 * deterministic, one-shot by default, and never read by production config.
 */
export class ChaosInjector {
  private readonly faults = new Map<ChaosBoundary, { fault: ChaosFault; remaining: number }>();

  inject(boundary: ChaosBoundary, fault: ChaosFault, count = 1): this {
    if (!Number.isSafeInteger(count) || count <= 0) throw new RangeError("Chaos fault count must be a positive safe integer");
    if (fault.kind === "delay" && (!Number.isSafeInteger(fault.delayMs) || fault.delayMs < 0)) throw new RangeError("Chaos delay must be a non-negative safe integer");
    this.faults.set(boundary, { fault, remaining: count });
    return this;
  }

  hasPending(boundary: ChaosBoundary): boolean {
    return (this.faults.get(boundary)?.remaining ?? 0) > 0;
  }

  async checkpoint(boundary: ChaosBoundary): Promise<void> {
    const entry = this.consume(boundary);
    if (entry === undefined) return;
    if (entry.kind === "delay") {
      await new Promise<void>((resolve) => setTimeout(resolve, entry.delayMs));
      return;
    }
    if (entry.kind === "throw") throw entry.error;
    throw new TypeError(`Corruption fault at ${boundary} requires run() or corrupt()`);
  }

  corrupt<T>(boundary: ChaosBoundary, value: T): T {
    const entry = this.consume(boundary);
    if (entry === undefined) return value;
    if (entry.kind !== "corrupt") throw new TypeError(`Non-corruption fault at ${boundary} requires checkpoint()`);
    return entry.transform(value) as T;
  }

  async run<T>(boundary: ChaosBoundary, operation: () => Promise<T> | T): Promise<T> {
    const entry = this.consume(boundary);
    if (entry === undefined) return await operation();
    if (entry.kind === "delay") {
      await new Promise<void>((resolve) => setTimeout(resolve, entry.delayMs));
      return await operation();
    }
    if (entry.kind === "throw") throw entry.error;
    return entry.transform(await operation()) as T;
  }

  private consume(boundary: ChaosBoundary): ChaosFault | undefined {
    const entry = this.faults.get(boundary);
    if (entry === undefined || entry.remaining <= 0) return undefined;
    entry.remaining -= 1;
    if (entry.remaining === 0) this.faults.delete(boundary);
    return entry.fault;
  }
}

export function createChaosInjector(): ChaosInjector {
  return new ChaosInjector();
}
