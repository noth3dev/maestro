import { performance } from "node:perf_hooks";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Pool } from "pg";
import { deriveDiscordIncidentFingerprint, signDiscordSignal, type AuthenticatedDiscordSignal, type DiscordSignal } from "@maestro/domain";
import { createDiscord, createHttpDelivery } from "../../apps/discord/src/main.js";

type Distribution = { readonly p50: number; readonly p95: number; readonly max: number };
type SignalRow = { readonly signal_id: string; readonly incident_fingerprint: string; readonly nonce: string; readonly sequence: number; readonly affected_component: string; readonly affected_version: string; readonly received_at: string | null };
type BufferLine = { readonly kind: "signal" | "delivered"; readonly signal?: AuthenticatedDiscordSignal; readonly nonce?: string };

export interface DiscordDetectionDeliveryBaseline {
  readonly metric: "discord-observation-delivery";
  readonly database: "postgresql";
  readonly detector: "synthetic-test-observation";
  readonly detectionMeasured: false;
  readonly provider: "not invoked";
  readonly sampleCount: number;
  readonly observationToDurableMs: Distribution;
  readonly recoveryToDurableMs: number;
  readonly durable: { readonly signalRows: number; readonly incidentLinks: number; readonly incidents: number };
  readonly recovery: { readonly timerDriven: true; readonly pendingBeforeRecovery: number; readonly pendingAfterRecovery: number; readonly failedAttempts: number; readonly successfulAttempts: number; readonly exactlyOnceAfterRestart: boolean };
}

interface MeasurementOptions {
  readonly pool: Pool;
  readonly baseUrl: string;
  readonly operatorCredential: string;
  readonly signalCredential: string;
}

const SAMPLE_COUNT = 10;
const FLUSH_INTERVAL_MS = 10;
const FRESHNESS_WINDOW_MS = 300_000;

function signalFor(sequence: number): DiscordSignal {
  const now = Date.now();
  const value: DiscordSignal = {
    incidentFingerprint: "",
    firstObservedAt: new Date(now - 2000).toISOString(),
    lastObservedAt: new Date(now - 1000).toISOString(),
    severity: "warning",
    confidence: 0.9,
    affectedComponent: `control-plane-health-${sequence}`,
    affectedVersion: `2.0.${sequence}`,
    minimalReproductionEvidence: ["GET /health -> 503"],
    source: "health-probe",
    sourceFreshness: new Date(now - 1000).toISOString(),
    deduplicationRelationship: "new",
    discordHealthState: "healthy",
  };
  return { ...value, incidentFingerprint: deriveDiscordIncidentFingerprint(value) };
}

function distribution(samples: readonly number[]): Distribution {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    p50: sorted[Math.floor((sorted.length - 1) * 0.5)]!,
    p95: sorted[Math.floor((sorted.length - 1) * 0.95)]!,
    max: Math.max(...sorted),
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, FLUSH_INTERVAL_MS));
  }
  throw new Error("Timed out waiting for Discord timer-driven delivery");
}

async function rowsFor(pool: Pool): Promise<SignalRow[]> {
  const result = await pool.query<SignalRow>("SELECT signal_id::text, incident_fingerprint, nonce, sequence::int, affected_component, affected_version, received_at::text FROM discord_signals ORDER BY sequence");
  return result.rows;
}

async function bufferLines(path: string): Promise<BufferLine[]> {
  const text = await readFile(path, "utf8");
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as BufferLine);
}

export async function measureDiscordDetectionDelivery(options: MeasurementOptions): Promise<DiscordDetectionDeliveryBaseline> {
  const observationToDurable: number[] = [];
  const envelopes: AuthenticatedDiscordSignal[] = [];

  for (let sequence = 1; sequence <= SAMPLE_COUNT; sequence += 1) {
    const directory = await mkdtemp(join("/tmp", "discord-perf-"));
    const bufferPath = join(directory, "buffer.jsonl");
    const envelope = signDiscordSignal(signalFor(sequence), options.signalCredential, randomUUID(), sequence);
    const discord = createDiscord(
      { bufferPath, credential: options.signalCredential, flushIntervalMs: FLUSH_INTERVAL_MS, freshnessWindowMs: FRESHNESS_WINDOW_MS, targetApiUrl: options.baseUrl, targetApiToken: options.operatorCredential },
      createHttpDelivery(options.baseUrl, options.operatorCredential),
    );
    try {
      const started = performance.now();
      await discord.emit(envelope);
      const rows = await options.pool.query<SignalRow>("SELECT signal_id::text, incident_fingerprint, nonce, sequence::int, affected_component, affected_version, received_at::text FROM discord_signals WHERE nonce = $1", [envelope.nonce]);
      observationToDurable.push(performance.now() - started);
      if (rows.rows.length !== 1) throw new Error(`Expected one durable Discord row for sequence ${sequence}`);
      const row = rows.rows[0]!;
      if (row.nonce !== envelope.nonce || row.sequence !== sequence || row.incident_fingerprint !== envelope.signal.incidentFingerprint || row.affected_component !== envelope.signal.affectedComponent || row.affected_version !== envelope.signal.affectedVersion || row.received_at === null) {
        throw new Error(`Durable Discord row identity mismatch for sequence ${sequence}`);
      }
      if (discord.pendingCount() !== 0) throw new Error(`Healthy Discord delivery remained pending for sequence ${sequence}`);
      envelopes.push(envelope);
    } finally {
      await discord.close();
      await rm(directory, { recursive: true, force: true });
    }
  }

  let available = false;
  let failedAttempts = 0;
  let successfulAttempts = 0;
  const directory = await mkdtemp(join("/tmp", "discord-recovery-perf-"));
  const bufferPath = join(directory, "buffer.jsonl");
  const gatedFetch: typeof fetch = async (input, init) => {
    if (!available) {
      failedAttempts += 1;
      throw new Error("simulated control-plane outage");
    }
    successfulAttempts += 1;
    return fetch(input, init);
  };
  const delivery = createHttpDelivery(options.baseUrl, options.operatorCredential, gatedFetch);
  const discord = createDiscord({ bufferPath, credential: options.signalCredential, flushIntervalMs: FLUSH_INTERVAL_MS, freshnessWindowMs: FRESHNESS_WINDOW_MS }, delivery);
  const recoveryEnvelope = signDiscordSignal(signalFor(SAMPLE_COUNT + 1), options.signalCredential, randomUUID(), SAMPLE_COUNT + 1);
  let recoveryToDurableMs = 0;
  try {
    await discord.listen();
    await discord.emit(recoveryEnvelope);
    const pendingBeforeRecovery = discord.pendingCount();
    if (pendingBeforeRecovery !== 1 || failedAttempts < 1) throw new Error("Discord outage did not leave one pending signal after a failed delivery");
    const recoveryStarted = performance.now();
    available = true;
    await waitFor(() => discord.pendingCount() === 0);
    recoveryToDurableMs = performance.now() - recoveryStarted;
    const recoveredRows = await options.pool.query<SignalRow>("SELECT signal_id::text, incident_fingerprint, nonce, sequence::int, affected_component, affected_version, received_at::text FROM discord_signals WHERE nonce = $1", [recoveryEnvelope.nonce]);
    if (recoveredRows.rows.length !== 1 || recoveredRows.rows[0]!.received_at === null) throw new Error("Timer recovery did not create one durable Discord row");
    await discord.close();
    const lines = await bufferLines(bufferPath);
    if (lines.filter((line) => line.kind === "signal").length !== 1 || lines.filter((line) => line.kind === "delivered").length !== 1) throw new Error("Discord recovery buffer did not contain one signal and one delivery record");

    const restarted = createDiscord({ bufferPath, credential: options.signalCredential, flushIntervalMs: FLUSH_INTERVAL_MS, freshnessWindowMs: FRESHNESS_WINDOW_MS }, delivery);
    await restarted.emit(recoveryEnvelope);
    await restarted.close();
    if (successfulAttempts !== 1) throw new Error("Discord restart redelivered an already delivered nonce");

    const rows = await rowsFor(options.pool);
    const expected = [...envelopes, recoveryEnvelope];
    if (rows.length !== expected.length) throw new Error(`Expected ${expected.length} Discord rows, got ${rows.length}`);
    expected.forEach((envelope, index) => {
      const row = rows[index]!;
      if (row.nonce !== envelope.nonce || row.sequence !== envelope.sequence || row.incident_fingerprint !== envelope.signal.incidentFingerprint || row.affected_component !== envelope.signal.affectedComponent || row.affected_version !== envelope.signal.affectedVersion || row.received_at === null || !/^[0-9a-f-]{36}$/.test(row.signal_id)) throw new Error(`Discord durable identity mismatch at row ${index}`);
    });
    const [links, incidents] = await Promise.all([
      options.pool.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM discord_incident_signals"),
      options.pool.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM discord_incidents"),
    ]);
    return {
      metric: "discord-observation-delivery",
      database: "postgresql",
      detector: "synthetic-test-observation",
      detectionMeasured: false,
      provider: "not invoked",
      sampleCount: observationToDurable.length,
      observationToDurableMs: distribution(observationToDurable),
      recoveryToDurableMs,
      durable: { signalRows: rows.length, incidentLinks: links.rows[0]!.count, incidents: incidents.rows[0]!.count },
      recovery: { timerDriven: true, pendingBeforeRecovery, pendingAfterRecovery: discord.pendingCount(), failedAttempts, successfulAttempts, exactlyOnceAfterRestart: successfulAttempts === 1 },
    };
  } finally {
    await discord.close();
    await rm(directory, { recursive: true, force: true });
  }
}
