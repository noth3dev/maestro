import { randomUUID } from "node:crypto";
import { verifyFireflySignal, type AuthenticatedFireflySignal, type FireflyReplayState, type FireflySignal } from "@maestro/domain";
import type { Pool } from "pg";
import { attachSignalToIncidentInTransaction } from "./firefly-incident.js";
export class FireflyPersistenceError extends Error {}
export interface StoredFireflySignal extends FireflySignal { readonly signalId: string; readonly nonce: string; readonly sequence: number; readonly issuedAt: string; readonly signature: string; readonly receivedAt: string; }
function map(row: Record<string, unknown>): StoredFireflySignal { return { signalId: String(row.signal_id), incidentFingerprint: String(row.incident_fingerprint), firstObservedAt: new Date(String(row.first_observed_at)).toISOString(), lastObservedAt: new Date(String(row.last_observed_at)).toISOString(), severity: row.severity as FireflySignal["severity"], confidence: Number(row.confidence), affectedComponent: String(row.affected_component), affectedVersion: String(row.affected_version), minimalReproductionEvidence: row.minimal_reproduction_evidence as string[], source: String(row.source), sourceFreshness: String(row.source_freshness), deduplicationRelationship: row.deduplication_relationship as FireflySignal["deduplicationRelationship"], fireflyHealthState: row.firefly_health_state as FireflySignal["fireflyHealthState"], nonce: String(row.nonce), sequence: Number(row.sequence), issuedAt: new Date(String(row.issued_at)).toISOString(), signature: String(row.signature), receivedAt: new Date(String(row.received_at)).toISOString() }; }
export async function recordFireflySignal(pool: Pool, envelope: AuthenticatedFireflySignal, credential: string, options: { now?: Date; freshnessWindowMs?: number } = {}): Promise<StoredFireflySignal> {
  const client = await pool.connect(); let open = false;
  try { await client.query("BEGIN"); open = true;
    // Serialize receivers before reading the high-water mark. Without a
    // writer lock, concurrent transactions can both observe the same maximum
    // sequence and commit out of order.
    await client.query("LOCK TABLE firefly_signals IN SHARE ROW EXCLUSIVE MODE");
    const prior = await client.query<{ nonce: string }>("SELECT nonce FROM firefly_signals WHERE nonce = $1 FOR SHARE", [envelope.nonce]);
    const latest = await client.query<{ highest_sequence: string | null }>("SELECT max(sequence) AS highest_sequence FROM firefly_signals");
    const replay: FireflyReplayState = { nonces: new Set(prior.rows.map((row) => row.nonce)), highestSequence: Number(latest.rows[0]?.highest_sequence ?? -1) };
    verifyFireflySignal(envelope, credential, options.now?.getTime(), options.freshnessWindowMs, replay);
    const inserted = await client.query<Record<string, unknown>>(`INSERT INTO firefly_signals (signal_id,incident_fingerprint,first_observed_at,last_observed_at,severity,confidence,affected_component,affected_version,minimal_reproduction_evidence,source,source_freshness,deduplication_relationship,firefly_health_state,nonce,sequence,issued_at,signature) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`, [randomUUID(), envelope.signal.incidentFingerprint, envelope.signal.firstObservedAt, envelope.signal.lastObservedAt, envelope.signal.severity, envelope.signal.confidence, envelope.signal.affectedComponent, envelope.signal.affectedVersion, JSON.stringify(envelope.signal.minimalReproductionEvidence), envelope.signal.source, envelope.signal.sourceFreshness, envelope.signal.deduplicationRelationship, envelope.signal.fireflyHealthState, envelope.nonce, envelope.sequence, envelope.issuedAt, envelope.signature]);
    const stored = map(inserted.rows[0]!);
    // Deduplicated incident attachment happens in this same transaction so a
    // received signal is never an orphan: either both the signal and its
    // incident linkage commit together, or neither does.
    await attachSignalToIncidentInTransaction(client, stored.signalId);
    await client.query("COMMIT"); open = false; return stored;
  } catch (error) { if (open) await client.query("ROLLBACK"); throw new FireflyPersistenceError("Firefly signal was not recorded", { cause: error }); } finally { client.release(); }
}
export async function listFireflySignals(pool: Pool, fingerprint?: string): Promise<readonly StoredFireflySignal[]> { const result = await pool.query<Record<string, unknown>>("SELECT * FROM firefly_signals WHERE ($1::text IS NULL OR incident_fingerprint = $1) ORDER BY sequence", [fingerprint ?? null]); return result.rows.map(map); }
