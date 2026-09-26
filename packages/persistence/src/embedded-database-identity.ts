import { readFile, realpath, stat } from "node:fs/promises";
import { join } from "node:path";

export interface EmbeddedDatabaseIdentity {
  readonly databasePath: string;
  readonly databaseDevice: string;
  readonly databaseInode: string;
}

export interface EmbeddedDatabaseProcessIdentity {
  readonly bootId: string;
  readonly startTime: string;
}

export async function getEmbeddedDatabaseIdentity(dataDir: string): Promise<EmbeddedDatabaseIdentity> {
  const path = join(dataDir, "embedded-postgres");
  const databasePath = await realpath(path);
  const metadata = await stat(databasePath);
  const verifiedPath = await realpath(path);
  const verifiedMetadata = await stat(verifiedPath);
  if (databasePath !== verifiedPath || metadata.dev !== verifiedMetadata.dev || metadata.ino !== verifiedMetadata.ino) {
    throw new Error("Embedded database directory changed while its identity was being checked");
  }
  return {
    databasePath,
    databaseDevice: String(metadata.dev),
    databaseInode: String(metadata.ino),
  };
}

export function parseLinuxProcessStartTime(processStat: string): string | undefined {
  const commandEnd = processStat.lastIndexOf(") ");
  if (commandEnd === -1) return undefined;
  const fields = processStat
    .slice(commandEnd + 2)
    .trim()
    .split(/\s+/);
  // `/proc/<pid>/stat` starts this slice at field 3 (state), so starttime (field 22) is index 19.
  return fields[19] || undefined;
}

export async function getLinuxProcessIdentity(pid: number): Promise<EmbeddedDatabaseProcessIdentity | undefined> {
  if (process.platform !== "linux") return undefined;
  try {
    const [processStat, bootId] = await Promise.all([
      readFile(`/proc/${pid}/stat`, "utf8"),
      readFile("/proc/sys/kernel/random/boot_id", "utf8"),
    ]);
    const startTime = parseLinuxProcessStartTime(processStat);
    const normalizedBootId = bootId.trim();
    if (startTime === undefined || normalizedBootId === "") return undefined;
    return { bootId: normalizedBootId, startTime };
  } catch {
    return undefined;
  }
}

export interface EmbeddedDatabaseProcessEnvironment {
  readonly dataDir?: string;
  readonly maxConnections?: string;
}

export async function readEmbeddedDatabaseProcessEnvironment(pid: number): Promise<EmbeddedDatabaseProcessEnvironment | undefined> {
  // Decode only allowlisted database configuration entries; never decode or log other inherited values.
  let environment: Buffer;
  try {
    environment = await readFile(`/proc/${pid}/environ`);
  } catch {
    return undefined;
  }
  const prefixes = {
    dataDir: Buffer.from("MAESTRO_EMBEDDED_DATABASE_DIR="),
    maxConnections: Buffer.from("MAESTRO_EMBEDDED_DATABASE_MAX_CONNECTIONS="),
  } as const;
  let dataDir: string | undefined;
  let maxConnections: string | undefined;
  let dataDirSeen = false;
  let maxConnectionsSeen = false;
  for (let start = 0; start < environment.length;) {
    const separator = environment.indexOf(0, start);
    const end = separator === -1 ? environment.length : separator;
    const entry = environment.subarray(start, end);
    if (entry.length >= prefixes.dataDir.length && entry.subarray(0, prefixes.dataDir.length).equals(prefixes.dataDir)) {
      if (dataDirSeen) return undefined;
      dataDirSeen = true;
      dataDir = entry.subarray(prefixes.dataDir.length).toString("utf8");
    } else if (
      entry.length >= prefixes.maxConnections.length &&
      entry.subarray(0, prefixes.maxConnections.length).equals(prefixes.maxConnections)
    ) {
      if (maxConnectionsSeen) return undefined;
      maxConnectionsSeen = true;
      maxConnections = entry.subarray(prefixes.maxConnections.length).toString("utf8");
    }
    if (separator === -1) break;
    start = separator + 1;
  }
  return {
    ...(dataDir === undefined ? {} : { dataDir }),
    ...(maxConnections === undefined ? {} : { maxConnections }),
  };
}
