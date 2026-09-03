import { spawn as nodeSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { basename, relative, resolve } from "node:path";
import type { ActionRequest, AuthorityDecision } from "@maestro/authority";
import {
  assertValidEnvironmentRecord,
  canonicalJson,
  type EnvironmentCommandRequest,
  type EnvironmentExecutionPort,
  type EnvironmentProcessHandle,
  type EnvironmentProcessResult,
  type EnvironmentRecord,
} from "@maestro/domain";

/** The deliberately small process surface used by both runtime adapters. */
export interface SpawnedProcess {
  readonly stdout: ProcessOutputStream;
  readonly stderr: ProcessOutputStream;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "close", listener: (code: number | null, signal: string | null) => void): unknown;
  kill(signal?: string): boolean;
}

export interface ProcessOutputStream {
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
}

export interface ProcessSpawnOptions {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly shell: false;
}

export type ProcessSpawner = (
  executable: string,
  args: readonly string[],
  options: ProcessSpawnOptions,
) => SpawnedProcess;

export interface EnvironmentAuthorityGateway {
  execute(
    request: ActionRequest,
    effect: () => Promise<unknown>,
  ): Promise<AuthorityDecision>;
}

export interface EnvironmentAdapterOptions {
  readonly clock?: () => Date;
  readonly spawn?: ProcessSpawner;
  /** Optional durable reread used to close state/expiry TOCTOU windows. */
  readonly readEnvironment?: () => Promise<EnvironmentRecord | undefined>;
  readonly invocationId?: () => string;
  readonly defaultOutputCapBytes?: number;
  readonly cancelGraceMs?: number;
  readonly dockerExecutable?: string;
}

export class EnvironmentExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class EnvironmentBoundaryError extends EnvironmentExecutionError {}

export class EnvironmentAuthorizationError extends EnvironmentExecutionError {
  constructor(readonly decision: AuthorityDecision) {
    super(`Environment command was not authorized: ${decision.reason}`);
  }
}

const DEFAULT_OUTPUT_CAP_BYTES = 1024 * 1024;
const DEFAULT_CANCEL_GRACE_MS = 250;
const SECRET_NAME = /(?:password|passwd|secret|token|private[_-]?key|api[_-]?key)/i;
const ENVIRONMENT_ALLOWLIST_KEYS = [
  "environmentAllowlist",
  "allowedEnvironment",
  "environmentVariables",
] as const;

type EnvironmentType = "local_worktree" | "container_sandbox";
type SpawnPlan = {
  readonly executable: string;
  readonly args: readonly string[];
  readonly options: ProcessSpawnOptions;
};

const defaultProcessSpawner: ProcessSpawner = (executable, args, options) =>
  nodeSpawn(executable, [...args], {
    cwd: options.cwd,
    env: { ...options.env },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  }) as unknown as SpawnedProcess;

function nonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function objectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(nonblank);
}

function recipeArray(record: EnvironmentRecord, key: (typeof ENVIRONMENT_ALLOWLIST_KEYS)[number]): readonly string[] {
  const value = record.recipe[key];
  return Array.isArray(value) && value.every(nonblank) ? value : [];
}

function environmentAllowlist(record: EnvironmentRecord): readonly string[] {
  for (const key of ENVIRONMENT_ALLOWLIST_KEYS) {
    const values = recipeArray(record, key);
    if (values.length > 0) return values;
  }
  return [];
}

function pathWithinAllowlist(candidate: string, allowlist: readonly string[]): boolean {
  const normalizedCandidate = resolve(candidate);
  return allowlist.some((allowed) => {
    if (!isAbsolutePath(allowed)) return false;
    const normalizedAllowed = resolve(allowed);
    const remainder = relative(normalizedAllowed, normalizedCandidate);
    return remainder === "" || (!remainder.startsWith("..") && !remainder.includes(".." + pathSeparator()));
  });
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

function pathSeparator(): string {
  return "/";
}

function validateRequestShape(request: unknown): asserts request is EnvironmentCommandRequest {
  if (!objectRecord(request)) {
    throw new EnvironmentBoundaryError("Environment command must be an object");
  }
  const candidate = request as Partial<EnvironmentCommandRequest>;
  if (!nonblank(candidate.commandId) || !nonblank(candidate.actorId) || !nonblank(candidate.action) || !nonblank(candidate.target)) {
    throw new EnvironmentBoundaryError("Environment command identity and authority fields are required");
  }
  if (!nonblank(candidate.controlEpoch) || !positiveSafeInteger(candidate.policyVersion) || typeof candidate.budgetEffectCents !== "number" || !Number.isSafeInteger(candidate.budgetEffectCents) || candidate.budgetEffectCents < 0) {
    throw new EnvironmentBoundaryError("Environment command authority fields are invalid");
  }
  if (!Array.isArray(candidate.argv) || candidate.argv.length === 0 || candidate.argv.some((part) => !nonblank(part) || part.includes("\0"))) {
    throw new EnvironmentBoundaryError("Environment command requires a non-empty argv array");
  }
  if (!nonblank(candidate.cwd) || !isAbsolutePath(candidate.cwd) || candidate.cwd.includes("\0")) {
    throw new EnvironmentBoundaryError("Environment command cwd must be an absolute path");
  }
  if (candidate.environment !== undefined && !objectRecord(candidate.environment)) {
    throw new EnvironmentBoundaryError("Environment variables must be an object");
  }
  const requestedEnvironment = candidate.environment ?? {};
  for (const [name, value] of Object.entries(requestedEnvironment)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof value !== "string" || value.includes("\0") || SECRET_NAME.test(name)) {
      throw new EnvironmentBoundaryError("Environment variables must be named, non-secret, and NUL-free");
    }
  }
  if (candidate.timeoutMs !== undefined && !positiveSafeInteger(candidate.timeoutMs)) {
    throw new EnvironmentBoundaryError("Environment command timeout must be a positive safe integer");
  }
  if (candidate.outputCapBytes !== undefined && !positiveSafeInteger(candidate.outputCapBytes)) {
    throw new EnvironmentBoundaryError("Environment output cap must be a positive safe integer");
  }
}

function validateEnvironment(
  record: EnvironmentRecord,
  expectedType: EnvironmentType,
  request: EnvironmentCommandRequest,
  now: Date,
  defaultOutputCapBytes: number,
): { timeoutMs: number; outputCapBytes: number } {
  try {
    assertValidEnvironmentRecord(record);
  } catch (error) {
    throw new EnvironmentExecutionError(error instanceof Error ? error.message : String(error));
  }
  if (record.type !== expectedType) {
    throw new EnvironmentBoundaryError(`Environment type ${record.type} cannot serve ${expectedType} commands`);
  }
  if (request.actorId !== record.workerId) {
    throw new EnvironmentBoundaryError("Environment command actor is not the assigned worker");
  }
  const boundaries = record.boundaries as unknown;
  const rawResources = record.resources as unknown;
  if (!objectRecord(record.recipe) || !objectRecord(record.resolvedInputs) || !objectRecord(boundaries) || !objectRecord(rawResources) ||
      !stringList(boundaries.network) || !stringList(boundaries.filesystem) || !stringList(boundaries.processes) ||
      !stringList(boundaries.browsers) || !stringList(boundaries.devices) ||
      !objectRecord(record.health) || !objectRecord(record.cleanup) ||
      !["unknown", "healthy", "unhealthy"].includes(record.health.status)) {
    throw new EnvironmentBoundaryError("Environment boundaries, health, or resource records are malformed");
  }
  if (record.state !== "ready" || record.health.status !== "healthy") {
    throw new EnvironmentExecutionError(`Environment is not ready and healthy (${record.state})`);
  }
  const expiresAt = Date.parse(record.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
    throw new EnvironmentExecutionError("Environment has expired");
  }
  if (!Array.isArray(record.boundaries.filesystem) || !pathWithinAllowlist(request.cwd, record.boundaries.filesystem)) {
    throw new EnvironmentBoundaryError("Environment cwd is outside its filesystem boundary");
  }
  // Absolute targets identify project paths. Relative or opaque targets (for
  // example a Git ref) remain bounded by the exact authority request.
  if (isAbsolutePath(request.target) && !pathWithinAllowlist(request.target, record.boundaries.filesystem)) {
    throw new EnvironmentBoundaryError("Environment project target is outside its filesystem boundary");
  }
  const executable = basename(request.argv[0]!);
  if (!record.boundaries.processes.includes(executable) && !record.boundaries.processes.includes(request.argv[0]!)) {
    throw new EnvironmentBoundaryError(`Process is outside the environment process boundary: ${executable}`);
  }
  if (!record.capabilities.some((capability) => capability.name === executable || capability.name === request.argv[0])) {
    throw new EnvironmentBoundaryError(`Process capability is not installed: ${executable}`);
  }
  const allowedEnvironment = environmentAllowlist(record);
  if (Object.keys(request.environment ?? {}).some((name) => !allowedEnvironment.includes(name))) {
    throw new EnvironmentBoundaryError("Environment variable is outside the environment allowlist");
  }
  if (record.boundaries.network.length !== 1 || record.boundaries.network[0] !== "none") {
    throw new EnvironmentBoundaryError("Only an explicit network=none environment is supported by this adapter");
  }
  const resources = record.resources;
  if (!positiveSafeInteger(resources.cpuMillis) || !positiveSafeInteger(resources.memoryMb) || !positiveSafeInteger(resources.diskMb) || !positiveSafeInteger(resources.processCount) || !positiveSafeInteger(resources.durationSeconds)) {
    throw new EnvironmentBoundaryError("Environment resource ceilings are invalid");
  }
  const durationCeilingMs = resources.durationSeconds * 1000;
  const remainingMs = expiresAt - now.getTime();
  const timeoutMs = request.timeoutMs ?? Math.min(durationCeilingMs, remainingMs);
  if (!positiveSafeInteger(timeoutMs) || timeoutMs > durationCeilingMs || timeoutMs > remainingMs) {
    throw new EnvironmentBoundaryError("Command timeout exceeds the environment resource or expiry ceiling");
  }
  const outputCapBytes = request.outputCapBytes ?? defaultOutputCapBytes;
  if (!positiveSafeInteger(outputCapBytes)) {
    throw new EnvironmentBoundaryError("Environment output cap is invalid");
  }
  return { timeoutMs, outputCapBytes };
}

function environmentBinding(record: EnvironmentRecord): string {
  return canonicalJson({
    environmentId: record.environmentId,
    recipeVersion: record.recipeVersion,
    goalId: record.goalId,
    departmentId: record.departmentId,
    workerId: record.workerId,
    projectId: record.projectId,
    missionId: record.missionId,
    type: record.type,
    recipe: record.recipe,
    resolvedInputs: record.resolvedInputs,
    capabilities: record.capabilities,
    boundaries: record.boundaries,
    secretsReferences: record.secretsReferences,
    resources: record.resources,
    expiresAt: record.expiresAt,
    contentIdentity: record.contentIdentity,
  });
}

function boundRecordReader(
  environment: EnvironmentRecord,
  readEnvironment: (() => Promise<EnvironmentRecord | undefined>) | undefined,
): () => Promise<EnvironmentRecord> {
  const binding = environmentBinding(environment);
  return async () => {
    const current = readEnvironment === undefined ? environment : await readEnvironment();
    if (current === undefined || environmentBinding(current) !== binding) {
      throw new EnvironmentExecutionError("Environment binding is missing or changed");
    }
    return current;
  };
}

function commandAuthorityRequest(record: EnvironmentRecord, request: EnvironmentCommandRequest): ActionRequest {
  return {
    commandId: request.commandId,
    projectId: record.projectId,
    actorId: request.actorId,
    goalId: record.goalId,
    action: request.action,
    target: request.target,
    policyVersion: request.policyVersion,
    budgetEffectCents: request.budgetEffectCents,
    controlEpoch: request.controlEpoch,
  };
}

function containerImage(record: EnvironmentRecord): string {
  const value = record.recipe.image ?? record.recipe.containerImage;
  if (!nonblank(value) || value.startsWith("-" ) || /[\r\n\0]/.test(value) || /\s/.test(value)) {
    throw new EnvironmentBoundaryError("Container recipe requires a safe image reference");
  }
  return value;
}

function outputBytes(chunk: Buffer | string): Buffer {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
}

function createHandle(
  process: SpawnedProcess,
  invocationId: string,
  startedAt: string,
  timeoutMs: number,
  outputCapBytes: number,
  cancelGraceMs: number,
  now: () => Date,
  release: () => void,
): EnvironmentProcessHandle {
  let status: EnvironmentProcessResult["status"] = "running";
  let exitCode: number | null = null;
  let signal: string | null = null;
  let completedAt: string | null = null;
  let errorMessage: string | undefined;
  let cancelled = false;
  let timedOut = false;
  let outputLimitExceeded = false;
  let settled = false;
  let terminationTimer: ReturnType<typeof setTimeout> | undefined;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  let capturedBytes = 0;
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];

  const terminate = (reason: "cancel" | "timeout" | "output"): void => {
    if (settled || (reason === "cancel" && cancelled) || (reason === "timeout" && timedOut) || (reason === "output" && outputLimitExceeded)) return;
    if (reason === "cancel") cancelled = true;
    if (reason === "timeout") timedOut = true;
    if (reason === "output") outputLimitExceeded = true;
    process.kill("SIGTERM");
    terminationTimer ??= setTimeout(() => {
      if (!settled) process.kill("SIGKILL");
    }, cancelGraceMs);
  };
  const append = (destination: Buffer[], chunk: Buffer | string): void => {
    if (settled) return;
    const bytes = outputBytes(chunk);
    const remaining = outputCapBytes - capturedBytes;
    if (remaining <= 0) {
      terminate("output");
      return;
    }
    const kept = bytes.subarray(0, remaining);
    destination.push(kept);
    capturedBytes += kept.length;
    if (kept.length < bytes.length) terminate("output");
  };
  const finish = (code: number | null, closeSignal: string | null): void => {
    if (settled) return;
    settled = true;
    exitCode = code;
    signal = closeSignal;
    if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
    if (terminationTimer !== undefined) clearTimeout(terminationTimer);
    status = cancelled
      ? "cancelled"
      : timedOut
        ? "timed_out"
        : outputLimitExceeded
          ? "output_limit_exceeded"
          : code === 0
            ? "succeeded"
            : "failed";
    completedAt = now().toISOString();
    release();
  };

  process.stdout.on("data", (chunk) => append(stdout, chunk));
  process.stderr.on("data", (chunk) => append(stderr, chunk));
  process.on("error", (error) => {
    errorMessage = error.message;
    finish(null, null);
  });
  process.on("close", (code, closeSignal) => finish(code, closeSignal));
  timeoutTimer = setTimeout(() => {
    if (!settled) terminate("timeout");
  }, timeoutMs);

  return {
    invocationId,
    async observe(): Promise<EnvironmentProcessResult> {
      return {
        invocationId,
        status,
        exitCode,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        outputTruncated: outputLimitExceeded,
        startedAt,
        completedAt,
        ...(errorMessage === undefined ? {} : { error: errorMessage }),
      };
    },
    async cancel(): Promise<{ cancelled: boolean }> {
      if (settled || cancelled || timedOut || outputLimitExceeded) return { cancelled: false };
      terminate("cancel");
      return { cancelled: true };
    },
  };
}

function createAdapter(
  environment: EnvironmentRecord,
  expectedType: EnvironmentType,
  authority: EnvironmentAuthorityGateway,
  options: EnvironmentAdapterOptions,
  plan: (record: EnvironmentRecord, request: EnvironmentCommandRequest) => SpawnPlan,
): EnvironmentExecutionPort {
  const clock = options.clock ?? (() => new Date());
  const spawn = options.spawn ?? defaultProcessSpawner;
  const nextInvocationId = options.invocationId ?? (() => randomUUID());
  const defaultOutputCapBytes = options.defaultOutputCapBytes ?? DEFAULT_OUTPUT_CAP_BYTES;
  const cancelGraceMs = options.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS;
  let activeProcesses = 0;
  let sequence = 0;
  const readBoundEnvironment = boundRecordReader(environment, options.readEnvironment);

  return {
    async start(request): Promise<EnvironmentProcessHandle> {
      validateRequestShape(request);
      const initial = await readBoundEnvironment();
      const limits = validateEnvironment(initial, expectedType, request, clock(), defaultOutputCapBytes);
      // Build the provider plan before authority so malformed container recipes
      // cannot produce an audited allow decision without any possible effect.
      plan(initial, request);
      if (activeProcesses >= initial.resources.processCount) {
        throw new EnvironmentBoundaryError("Environment process ceiling reached");
      }
      activeProcesses += 1;
      let released = false;
      let started = false;
      const release = (): void => {
        if (!released) {
          released = true;
          activeProcesses -= 1;
        }
      };
      try {
        const authorityRequest = commandAuthorityRequest(initial, request);
        let handle: EnvironmentProcessHandle | undefined;
        const decision = await authority.execute(authorityRequest, async () => {
          const current = await readBoundEnvironment();
          const currentLimits = validateEnvironment(current, expectedType, request, clock(), defaultOutputCapBytes);
          const currentPlan = plan(current, request);
          let child: SpawnedProcess;
          try {
            child = spawn(currentPlan.executable, currentPlan.args, currentPlan.options);
          } catch (error) {
            throw new EnvironmentExecutionError(`Environment process failed to start: ${error instanceof Error ? error.message : String(error)}`);
          }
          started = true;
          handle = createHandle(child, `environment-invocation-${++sequence}-${nextInvocationId()}`, clock().toISOString(), currentLimits.timeoutMs, currentLimits.outputCapBytes, cancelGraceMs, clock, release);
        });
        if (decision.effect !== "allow") throw new EnvironmentAuthorizationError(decision);
        if (handle === undefined) throw new EnvironmentExecutionError("Authority gateway allowed without starting a process");
        return handle;
      } catch (error) {
        if (!started) release();
        throw error;
      }
    },
  };
}

export function createLocalRuntimeAdapter(
  environment: EnvironmentRecord,
  authority: EnvironmentAuthorityGateway,
  options: EnvironmentAdapterOptions = {},
): EnvironmentExecutionPort {
  return createAdapter(environment, "local_worktree", authority, options, (_record, request) => ({
    executable: request.argv[0]!,
    args: request.argv.slice(1),
    options: {
      cwd: request.cwd,
      env: { ...(request.environment ?? {}) },
      shell: false,
    },
  }));
}

export function createContainerSandboxAdapter(
  environment: EnvironmentRecord,
  authority: EnvironmentAuthorityGateway,
  options: EnvironmentAdapterOptions = {},
): EnvironmentExecutionPort {
  return createAdapter(environment, "container_sandbox", authority, options, (record, request) => {
    const image = containerImage(record);
    const environmentArguments = Object.entries(request.environment ?? {}).flatMap(([name, value]) => ["--env", `${name}=${value}`]);
    const args = [
      "run", "--rm", "--init", "--network", "none",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
      "--cpus", String(record.resources.cpuMillis / 1000),
      "--memory", `${record.resources.memoryMb}m`,
      "--pids-limit", String(record.resources.processCount),
      "--volume", `${request.cwd}:/workspace:rw`, "--workdir", "/workspace",
      ...environmentArguments,
      image,
      request.argv[0]!,
      ...request.argv.slice(1),
    ];
    return {
      executable: options.dockerExecutable ?? "docker",
      args,
      options: {
        cwd: request.cwd,
        env: { ...(request.environment ?? {}) },
        shell: false,
      },
    };
  });
}
