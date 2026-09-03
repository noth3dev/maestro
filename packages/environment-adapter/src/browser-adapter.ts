import { createHash, randomUUID } from "node:crypto";
import type { ActionRequest, AuthorityDecision } from "@maestro/authority";
import {
  assertValidBrowserCommandRequest,
  assertValidEnvironmentRecord,
  canonicalJson,
  type BrowserAction,
  type BrowserCommandHandle,
  type BrowserCommandRequest,
  type BrowserCommandResult,
  type BrowserCommandStatus,
  type BrowserExecutionPort,
  type EnvironmentRecord,
} from "@maestro/domain";
import {
  EnvironmentAuthorizationError,
  EnvironmentBoundaryError,
  EnvironmentExecutionError,
  type EnvironmentAuthorityGateway,
} from "./runtime-adapter.js";

/** The deliberately small browser surface both the default Playwright
 * driver and any test double must implement. */
export interface BrowserPage {
  goto(url: string, timeoutMs: number): Promise<void>;
  click(selector: string, timeoutMs: number): Promise<void>;
  fill(selector: string, value: string, timeoutMs: number): Promise<void>;
  textContent(selector: string, timeoutMs: number): Promise<string | null>;
  screenshot(timeoutMs: number): Promise<Buffer>;
  close(): Promise<void>;
}

export interface BrowserDriver {
  newPage(): Promise<BrowserPage>;
}

/** Records bounded screenshot bytes as content-addressed evidence and
 * returns only its reference; the browser adapter itself never embeds raw
 * bytes in a command result. Composition roots inject a real writer that
 * persists bytes and durable evidence metadata together. */
export interface BrowserEvidenceWriter {
  write(bytes: Uint8Array, mediaType: string): Promise<string>;
}

export interface BrowserAdapterOptions {
  readonly clock?: () => Date;
  readonly driver?: BrowserDriver;
  readonly evidence?: BrowserEvidenceWriter;
  readonly readEnvironment?: () => Promise<EnvironmentRecord | undefined>;
  readonly invocationId?: () => string;
  readonly maxCapturedTextLength?: number;
  readonly maxScreenshotBytes?: number;
  readonly cancelGraceMs?: number;
}

const DEFAULT_MAX_CAPTURED_TEXT_LENGTH = 8192;
const DEFAULT_MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;

const defaultBrowserDriver: BrowserDriver = {
  async newPage(): Promise<BrowserPage> {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    let page: Awaited<ReturnType<typeof browser.newPage>>;
    try {
      page = await browser.newPage();
    } catch (error) {
      await browser.close();
      throw error;
    }
    return {
      async goto(url, timeoutMs) { await page.goto(url, { timeout: timeoutMs }); },
      async click(selector, timeoutMs) { await page.click(selector, { timeout: timeoutMs }); },
      async fill(selector, value, timeoutMs) { await page.fill(selector, value, { timeout: timeoutMs }); },
      async textContent(selector, timeoutMs) { return page.textContent(selector, { timeout: timeoutMs }); },
      async screenshot(timeoutMs) { return page.screenshot({ timeout: timeoutMs }); },
      async close() { await browser.close(); },
    };
  },
};

const defaultEvidenceWriter: BrowserEvidenceWriter = {
  async write(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
  },
};

function nonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function objectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(nonblank);
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

function originOf(url: string): string {
  return new URL(url).origin;
}

function validateBrowserEnvironment(
  record: EnvironmentRecord,
  request: BrowserCommandRequest,
  now: Date,
): { timeoutMs: number } {
  try {
    assertValidEnvironmentRecord(record);
  } catch (error) {
    throw new EnvironmentExecutionError(error instanceof Error ? error.message : String(error));
  }
  if (record.type !== "browser_automation") throw new EnvironmentBoundaryError(`Environment type ${record.type} cannot serve browser_automation commands`);
  if (request.actorId !== record.workerId) throw new EnvironmentBoundaryError("Browser command actor is not the assigned worker");
  const boundaries = record.boundaries as unknown;
  const rawResources = record.resources as unknown;
  if (!objectRecord(boundaries) || !objectRecord(rawResources) ||
      !stringList((boundaries as Record<string, unknown>).browsers) || !stringList((boundaries as Record<string, unknown>).network) ||
      !objectRecord(record.health) || !["unknown", "healthy", "unhealthy"].includes(record.health.status)) {
    throw new EnvironmentBoundaryError("Environment boundaries, health, or resource records are malformed");
  }
  if (record.state !== "ready" || record.health.status !== "healthy") {
    throw new EnvironmentExecutionError(`Environment is not ready and healthy (${record.state})`);
  }
  const expiresAt = Date.parse(record.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) throw new EnvironmentExecutionError("Environment has expired");
  if (!record.boundaries.browsers.includes(request.action)) {
    throw new EnvironmentBoundaryError(`Browser action is outside the environment browser boundary: ${request.action}`);
  }
  if (request.action === "navigate") {
    if (record.boundaries.network.length === 0) throw new EnvironmentBoundaryError("Browser environment has no allowed navigation origin");
    if (!record.boundaries.network.includes(originOf(request.target))) {
      throw new EnvironmentBoundaryError(`Browser navigate target is outside the network allowlist: ${request.target}`);
    }
  }
  const resources = record.resources;
  if (!Number.isSafeInteger(resources.durationSeconds) || resources.durationSeconds <= 0 || !Number.isSafeInteger(resources.processCount) || resources.processCount <= 0) {
    throw new EnvironmentBoundaryError("Environment resource ceilings are invalid");
  }
  const durationCeilingMs = resources.durationSeconds * 1000;
  const remainingMs = expiresAt - now.getTime();
  const timeoutMs = request.timeoutMs ?? Math.min(durationCeilingMs, remainingMs);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > durationCeilingMs || timeoutMs > remainingMs) {
    throw new EnvironmentBoundaryError("Browser command timeout exceeds the environment resource or expiry ceiling");
  }
  return { timeoutMs };
}

function commandAuthorityRequest(record: EnvironmentRecord, request: BrowserCommandRequest): ActionRequest {
  return {
    commandId: request.commandId,
    projectId: record.projectId,
    actorId: request.actorId,
    goalId: record.goalId,
    action: `browser.${request.action}`,
    target: request.target,
    policyVersion: request.policyVersion,
    budgetEffectCents: request.budgetEffectCents,
    controlEpoch: request.controlEpoch,
  };
}

export function createBrowserEnvironmentAdapter(
  environment: EnvironmentRecord,
  authority: EnvironmentAuthorityGateway,
  options: BrowserAdapterOptions = {},
): BrowserExecutionPort {
  const clock = options.clock ?? (() => new Date());
  const driver = options.driver ?? defaultBrowserDriver;
  const evidence = options.evidence ?? defaultEvidenceWriter;
  const nextInvocationId = options.invocationId ?? (() => randomUUID());
  const maxCapturedTextLength = options.maxCapturedTextLength ?? DEFAULT_MAX_CAPTURED_TEXT_LENGTH;
  const maxScreenshotBytes = options.maxScreenshotBytes ?? DEFAULT_MAX_SCREENSHOT_BYTES;
  let activePages = 0;
  let sequence = 0;
  const readBoundEnvironment = boundRecordReader(environment, options.readEnvironment);

  return {
    async start(request): Promise<BrowserCommandHandle> {
      assertValidBrowserCommandRequest(request);
      const initial = await readBoundEnvironment();
      const { timeoutMs } = validateBrowserEnvironment(initial, request, clock());
      if (activePages >= initial.resources.processCount) throw new EnvironmentBoundaryError("Environment browser-page ceiling reached");
      activePages += 1;
      let released = false;
      let started = false;
      const release = (): void => {
        if (!released) {
          released = true;
          activePages -= 1;
        }
      };
      try {
        const authorityRequest = commandAuthorityRequest(initial, request);
        const invocationId = `browser-invocation-${++sequence}-${nextInvocationId()}`;
        const startedAt = clock().toISOString();
        let status: BrowserCommandStatus = "running";
        let capturedText: string | null = null;
        let evidenceRef: string | null = null;
        let completedAt: string | null = null;
        let errorMessage: string | undefined;

        const decision = await authority.execute(authorityRequest, async () => {
          const current = await readBoundEnvironment();
          validateBrowserEnvironment(current, request, clock());
          let page: BrowserPage | undefined;
          try {
            page = await driver.newPage();
            await runAction(page, request, timeoutMs, maxCapturedTextLength, maxScreenshotBytes, evidence, (text, ref) => {
              capturedText = text;
              evidenceRef = ref;
            });
            status = "succeeded";
          } catch (error) {
            status = "failed";
            errorMessage = error instanceof Error ? error.message : String(error);
          } finally {
            if (page !== undefined) await page.close().catch(() => undefined);
          }
          started = true;
          completedAt = clock().toISOString();
          release();
        });
        if (decision.effect !== "allow") throw new EnvironmentAuthorizationError(decision);
        if (!started) throw new EnvironmentExecutionError("Authority gateway allowed without executing a browser command");

        return {
          invocationId,
          async observe(): Promise<BrowserCommandResult> {
            return {
              invocationId,
              status,
              capturedText,
              evidenceRef,
              startedAt,
              completedAt,
              ...(errorMessage === undefined ? {} : { error: errorMessage }),
            };
          },
          async cancel(): Promise<{ cancelled: boolean }> {
            return { cancelled: false };
          },
        };
      } catch (error) {
        if (!started) release();
        throw error;
      }
    },
  };
}

async function runAction(
  page: BrowserPage,
  request: BrowserCommandRequest,
  timeoutMs: number,
  maxCapturedTextLength: number,
  maxScreenshotBytes: number,
  evidence: BrowserEvidenceWriter,
  onCapture: (text: string | null, evidenceRef: string | null) => void,
): Promise<void> {
  const action: BrowserAction = request.action;
  if (action === "navigate") {
    await page.goto(request.target, timeoutMs);
    return;
  }
  if (action === "click") {
    await page.click(request.target, timeoutMs);
    return;
  }
  if (action === "fill") {
    await page.fill(request.target, request.value!, timeoutMs);
    return;
  }
  if (action === "get_text") {
    const text = await page.textContent(request.target, timeoutMs);
    const bounded = text === null ? null : text.length > maxCapturedTextLength ? text.slice(0, maxCapturedTextLength) : text;
    onCapture(bounded, null);
    return;
  }
  const bytes = await page.screenshot(timeoutMs);
  if (bytes.length > maxScreenshotBytes) throw new EnvironmentExecutionError("Browser screenshot exceeds the evidence size cap");
  const evidenceRef = await evidence.write(bytes, "image/png");
  onCapture(null, evidenceRef);
}
