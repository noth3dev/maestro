import { createHash, randomUUID } from "node:crypto";
import { mkdir, link, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

export interface CorrelationContext {
  correlationId: string;
  commandId: string;
  projectId: string;
  goalId: string;
  actorId: string;
}

export interface EvidenceRecord {
  evidenceId: string;
  context: Readonly<CorrelationContext>;
  sha256: string;
  byteLength: number;
  kind: string;
  mediaType: string;
  createdAt: string;
  retention: "project_lifetime";
}

export interface CaptureEvidenceInput {
  context: CorrelationContext;
  bytes: Uint8Array;
  kind: string;
  mediaType: string;
}

/** Reads the immutable bytes addressed by an evidence SHA-256. */
export interface EvidenceContentReader {
  read(sha256: string): Promise<Uint8Array>;
}

export class EvidenceIntegrityError extends Error {
  constructor(message: string) { super(message); this.name = "EvidenceIntegrityError"; }
}

const hashPattern = /^[a-f0-9]{64}$/;
const kindPattern = /^[a-z][a-z0-9._-]{0,127}$/;
const mediaTypePattern = /^[a-z]+\/[a-z0-9.+-]+(?:;[a-z0-9._-]+=[a-z0-9._-]+)*$/;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The minimal shape verifyEvidenceRecord actually needs; any EvidenceRecord satisfies it. */
export type VerifiableEvidenceRecord = Pick<EvidenceRecord, "sha256" | "byteLength">;

/** Fails closed unless stored bytes still match durable evidence metadata. */
export async function verifyEvidenceRecord(record: VerifiableEvidenceRecord, content: EvidenceContentReader): Promise<void> {
  if (!hashPattern.test(record.sha256)) throw new EvidenceIntegrityError("Evidence SHA-256 must be lowercase hex");
  let bytes: Uint8Array;
  try {
    bytes = await content.read(record.sha256);
  } catch {
    throw new EvidenceIntegrityError(`Evidence artifact is unavailable: ${record.sha256}`);
  }
  if (bytes.byteLength !== record.byteLength) throw new EvidenceIntegrityError(`Evidence artifact byte length mismatch: ${record.sha256}`);
  if (sha256Hex(bytes) !== record.sha256) throw new EvidenceIntegrityError(`Evidence artifact hash mismatch: ${record.sha256}`);
}

/** Local, content-addressed evidence store. It never exposes mutation or deletion. */
export class FileEvidenceStore {
  private readonly root: string;
  private readonly objects: string;

  constructor(rootDirectory: string) {
    this.root = resolve(rootDirectory);
    this.objects = join(this.root, "sha256");
  }

  async capture(input: CaptureEvidenceInput): Promise<EvidenceRecord> {
    validateInput(input);
    const bytes = Buffer.from(input.bytes);
    const sha256 = sha256Hex(bytes);
    const path = this.objectPath(sha256);
    await mkdir(this.objects, { recursive: true, mode: 0o700 });
    await this.putImmutable(path, bytes, sha256);
    return Object.freeze({
      evidenceId: randomUUID(),
      context: Object.freeze({ ...input.context }),
      sha256,
      byteLength: bytes.byteLength,
      kind: input.kind,
      mediaType: input.mediaType,
      createdAt: new Date().toISOString(),
      retention: "project_lifetime" as const,
    });
  }

  async read(sha256: string): Promise<Uint8Array> {
    const path = this.objectPath(sha256);
    try { return await readFile(path); }
    catch { throw new EvidenceIntegrityError(`Evidence artifact is unavailable: ${sha256}`); }
  }

  async verify(sha256: string): Promise<void> {
    const bytes = await this.read(sha256);
    if (sha256Hex(bytes) !== sha256) throw new EvidenceIntegrityError(`Evidence artifact hash mismatch: ${sha256}`);
  }

  private objectPath(sha256: string): string {
    if (!hashPattern.test(sha256)) throw new EvidenceIntegrityError("Evidence SHA-256 must be lowercase hex");
    const path = join(this.objects, sha256);
    if (dirname(path) !== this.objects || basename(path) !== sha256) throw new EvidenceIntegrityError("Evidence path escaped storage root");
    return path;
  }

  private async putImmutable(path: string, bytes: Buffer, sha256: string): Promise<void> {
    const temp = join(this.objects, `.${randomUUID()}.partial`);
    try {
      await writeFile(temp, bytes, { mode: 0o600, flag: "wx" });
      try {
        // link is atomic and fails if a concurrent writer already owns the address.
        await link(temp, path);
      } catch (error: unknown) {
        if (!isAlreadyExists(error)) throw error;
      }
      await this.verify(sha256);
    } finally {
      await rm(temp, { force: true });
    }
  }
}

function validateInput(input: CaptureEvidenceInput): void {
  if (!kindPattern.test(input.kind)) throw new EvidenceIntegrityError("Evidence kind is invalid");
  if (!mediaTypePattern.test(input.mediaType)) throw new EvidenceIntegrityError("Evidence mediaType is invalid");
  if (!Number.isSafeInteger(input.bytes.byteLength) || input.bytes.byteLength < 0) throw new EvidenceIntegrityError("Evidence bytes are invalid");
  for (const [name, value] of Object.entries(input.context)) {
    if (typeof value !== "string" || value === "" || value.length > 256) throw new EvidenceIntegrityError(`Evidence context ${name} is invalid`);
  }
}
function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
