#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, chmodSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";
import { canonicalJson } from "@maestro/domain";
import { computeReleaseCandidateIdentity, recordReleaseCheckpoint, validateReleaseCandidateIdentity } from "@maestro/persistence";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
  console.error("Usage: node scripts/freeze-release-candidate.mjs --manifest <identity.json> --export-path <database.sql> [--database-url <url>]");
  process.exit(2);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") usage();
    if (!["--manifest", "--export-path", "--database-url"].includes(argument)) throw new Error(`Unknown option: ${argument}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    result[argument.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  return result;
}

function requiredText(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required`);
  return value.trim();
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readManifest(path) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not read release manifest: ${error instanceof Error ? error.message : "invalid JSON"}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Release manifest must be an object");
  const identity = parsed.identity ?? parsed;
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) throw new Error("Release manifest identity must be an object");
  return identity;
}

function databaseEnvironment(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("Database URL is invalid");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") throw new Error("Database URL must use postgres:// or postgresql://");
  const environment = { ...process.env, PGHOST: parsed.hostname, PGPORT: parsed.port || "5432", PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)) };
  if (parsed.username) environment.PGUSER = decodeURIComponent(parsed.username);
  if (parsed.password) environment.PGPASSWORD = decodeURIComponent(parsed.password);
  const sslMode = parsed.searchParams.get("sslmode");
  if (sslMode) environment.PGSSLMODE = sslMode;
  return environment;
}

function exportDatabase(databaseUrl, exportPath) {
  const absolutePath = isAbsolute(exportPath) ? exportPath : resolve(process.cwd(), exportPath);
  if (existsSync(absolutePath)) throw new Error(`Refusing to overwrite existing database export: ${absolutePath}`);
  mkdirSync(dirname(absolutePath), { recursive: true, mode: 0o700 });
  const temporaryDirectory = mkdtempSync(join(dirname(absolutePath), ".release-export-"));
  const temporaryPath = join(temporaryDirectory, "database.sql");
  try {
    const command = process.env.MAESTRO_PG_DUMP_COMMAND ?? "pg_dump";
    const result = spawnSync(command, ["--format=plain", "--no-owner", "--no-privileges", "--file", temporaryPath], {
      cwd: repositoryRoot,
      env: databaseEnvironment(databaseUrl),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error || result.status !== 0) {
      throw new Error(`pg_dump failed${result.status === null ? " to start" : ` with exit code ${result.status}`}`);
    }
    if (!existsSync(temporaryPath) || statSync(temporaryPath).size === 0) throw new Error("pg_dump produced an empty database export");
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, absolutePath);
    chmodSync(absolutePath, 0o600);
    return { path: absolutePath, sha256: sha256(readFileSync(absolutePath)) };
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

async function migrationLedgerHash(pool) {
  let result;
  try {
    result = await pool.query("SELECT filename, checksum FROM schema_migrations ORDER BY filename");
  } catch {
    throw new Error("Release freeze requires an existing schema_migrations ledger; run migrations before freezing");
  }
  if (result.rows.length === 0) throw new Error("Release freeze requires a non-empty schema_migrations ledger");
  const ledger = result.rows.map((row) => ({ filename: requiredText(row.filename, "migration filename"), checksum: requiredText(row.checksum, "migration checksum") }));
  if (ledger.some((row) => !/^[a-f0-9]{64}$/.test(row.checksum))) throw new Error("Migration ledger contains an invalid checksum");
  return sha256(canonicalJson(ledger));
}

async function assertRuntimePins(pool, identity, packageLockHash) {
  if (identity.pins.node !== process.version) throw new Error(`Manifest Node pin ${identity.pins.node} does not match this runtime ${process.version}`);
  if (identity.pins.packages !== packageLockHash) throw new Error("Manifest package pin does not match package-lock.json");
  const result = await pool.query("SHOW server_version");
  const serverVersion = String(result.rows[0]?.server_version ?? "").trim();
  if (identity.pins.postgres !== serverVersion) throw new Error(`Manifest PostgreSQL pin ${identity.pins.postgres} does not match the connected server ${serverVersion}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = requiredText(args.manifest ?? process.env.MAESTRO_RELEASE_MANIFEST, "--manifest or MAESTRO_RELEASE_MANIFEST");
  const databaseUrl = requiredText(args.database_url ?? process.env.MAESTRO_RELEASE_DATABASE_URL ?? process.env.DATABASE_URL ?? process.env.MAESTRO_TEST_DATABASE_URL, "database URL");
  const exportPath = requiredText(args.export_path ?? process.env.MAESTRO_RELEASE_EXPORT_PATH, "--export-path or MAESTRO_RELEASE_EXPORT_PATH");
  const manifest = readManifest(resolve(process.cwd(), manifestPath));
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  let exported;
  try {
    const migrationHash = await migrationLedgerHash(pool);
    if (manifest.schemaVersions?.database !== migrationHash) throw new Error("Manifest database schema pin does not match the durable migration ledger");
    const packageLockHash = sha256(readFileSync(join(repositoryRoot, "package-lock.json")));
    const declaredDatabaseStateHash = manifest.databaseStateHash;
    const identityInput = {
      ...manifest,
      databaseStateHash: "0".repeat(64),
      schemaVersions: { ...manifest.schemaVersions },
    };
    validateReleaseCandidateIdentity(identityInput);
    await assertRuntimePins(pool, identityInput, packageLockHash);
    exported = exportDatabase(databaseUrl, exportPath);
    if (declaredDatabaseStateHash !== undefined && declaredDatabaseStateHash !== exported.sha256) {
      throw new Error("Manifest database state hash does not match the additive database export");
    }
    identityInput.databaseStateHash = exported.sha256;
    const identity = validateReleaseCandidateIdentity(identityInput);
    const checkpoint = await recordReleaseCheckpoint(pool, {
      identity,
      databaseExportPath: exported.path,
      databaseExportSha256: exported.sha256,
    });
    console.log(JSON.stringify({ candidateId: checkpoint.candidateId, databaseExportPath: checkpoint.databaseExportPath, databaseExportSha256: checkpoint.databaseExportSha256, createdAt: checkpoint.createdAt }));
    // Compute once after persistence as an explicit integrity assertion for the CLI boundary.
    const persistedIdentity = {
      schemaVersions: checkpoint.schemaVersions,
      pins: checkpoint.pins,
      configuration: checkpoint.configuration,
      databaseStateHash: checkpoint.databaseStateHash,
      improvementClasses: checkpoint.improvementClasses,
    };
    if (computeReleaseCandidateIdentity(persistedIdentity) !== checkpoint.candidateId) throw new Error("Persisted release checkpoint identity could not be reproduced");
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Release freeze failed");
  process.exitCode = 1;
}
