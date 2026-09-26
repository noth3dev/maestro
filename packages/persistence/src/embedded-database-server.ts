import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openEmbeddedDatabase } from "./embedded-database.js";
import { getEmbeddedDatabaseIdentity, getLinuxProcessIdentity } from "./embedded-database-identity.js";

const dataDir = process.env.MAESTRO_EMBEDDED_DATABASE_DIR;
if (dataDir === undefined || dataDir.trim() === "") throw new Error("MAESTRO_EMBEDDED_DATABASE_DIR is required");
const markerPath = process.env.MAESTRO_EMBEDDED_DATABASE_MARKER;
const databaseDirectory = join(dataDir, "embedded-postgres");
await mkdir(databaseDirectory, { recursive: true, mode: 0o700 });
const identityBeforeOpen = await getEmbeddedDatabaseIdentity(dataDir);
const processIdentity = await getLinuxProcessIdentity(process.pid);
if (process.platform === "linux" && processIdentity === undefined) {
  throw new Error("Could not verify the embedded database server process identity");
}
const configuredMaxConnections = process.env.MAESTRO_EMBEDDED_DATABASE_MAX_CONNECTIONS;
const maxConnections = configuredMaxConnections === undefined ? 8 : Number(configuredMaxConnections);
if (!Number.isSafeInteger(maxConnections) || maxConnections < 1) {
  throw new Error("MAESTRO_EMBEDDED_DATABASE_MAX_CONNECTIONS must be a positive whole number");
}
const database = await openEmbeddedDatabase({
  dataDir,
  host: process.env.MAESTRO_EMBEDDED_DATABASE_HOST ?? "127.0.0.1",
  port: process.env.MAESTRO_EMBEDDED_DATABASE_PORT === undefined ? 55433 : Number(process.env.MAESTRO_EMBEDDED_DATABASE_PORT),
  maxConnections,
});
const identityAfterOpen = await getEmbeddedDatabaseIdentity(dataDir);
if (
  identityBeforeOpen.databasePath !== identityAfterOpen.databasePath ||
  identityBeforeOpen.databaseDevice !== identityAfterOpen.databaseDevice ||
  identityBeforeOpen.databaseInode !== identityAfterOpen.databaseInode
) {
  await database.stop();
  throw new Error("Embedded database directory changed while the database was opening");
}
if (markerPath !== undefined) {
  await writeFile(
    markerPath,
    JSON.stringify({
      pid: process.pid,
      databaseUrl: database.databaseUrl,
      maxConnections,
      ...identityBeforeOpen,
      ...(processIdentity === undefined ? {} : { processIdentity }),
    }),
    { mode: 0o600 },
  );
}
process.stdout.write(`READY ${database.databaseUrl}\n`);
const shutdown = async (): Promise<void> => {
  await database.stop();
  if (markerPath !== undefined) await unlink(markerPath).catch(() => undefined);
  process.exit(0);
};
process.once("SIGTERM", () => {
  void shutdown();
});
process.once("SIGINT", () => {
  void shutdown();
});
await new Promise<void>(() => undefined);
