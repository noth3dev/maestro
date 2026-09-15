import { openEmbeddedDatabase } from "./embedded-database.js";

const dataDir = process.env.MAESTRO_EMBEDDED_DATABASE_DIR;
if (dataDir === undefined || dataDir.trim() === "") throw new Error("MAESTRO_EMBEDDED_DATABASE_DIR is required");
const database = await openEmbeddedDatabase({
  dataDir,
  ...(process.env.MAESTRO_EMBEDDED_DATABASE_HOST === undefined ? {} : { host: process.env.MAESTRO_EMBEDDED_DATABASE_HOST }),
  ...(process.env.MAESTRO_EMBEDDED_DATABASE_PORT === undefined ? {} : { port: Number(process.env.MAESTRO_EMBEDDED_DATABASE_PORT) }),
  ...(process.env.MAESTRO_EMBEDDED_DATABASE_MAX_CONNECTIONS === undefined
    ? {}
    : { maxConnections: Number(process.env.MAESTRO_EMBEDDED_DATABASE_MAX_CONNECTIONS) }),
});
process.stdout.write(`READY ${database.databaseUrl}\n`);
const shutdown = async (): Promise<void> => {
  await database.stop();
  process.exit(0);
};
process.once("SIGTERM", () => {
  void shutdown();
});
process.once("SIGINT", () => {
  void shutdown();
});
await new Promise<void>(() => undefined);
