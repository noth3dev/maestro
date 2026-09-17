#!/usr/bin/env node
import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards the additive-only migration contract in
 * packages/persistence/migrations/ without touching the production ledger.
 *
 * What this checks:
 * - no NEW duplicate numeric prefixes (each migration gets a fresh prefix);
 * - the four frozen duplicate prefixes (0037/0038/0075/0077) still contain
 *   exactly the same filenames (rename/delete there fails the check).
 *
 * What this does NOT check: renames or deletions of singleton-prefix files.
 * runMigrations() keys schema_migrations on the full filename with a
 * checksum, so a renamed file would re-apply as a new migration on
 * databases that already applied it. Catching that needs a tracked filename
 * manifest, which is intentionally out of scope for this lint.
 *
 * Background: the frozen duplicates stay frozen because renaming an
 * already-applied file would re-apply it under the new name. Touch those
 * filenames only with a reviewed migration plan.
 */
const migrationsDirectory = join(import.meta.dirname, "..", "packages", "persistence", "migrations");

// Exact frozen state verified 2026-09-17. Any change here (rename, delete,
// or added file sharing one of these prefixes) fails the check on purpose:
// touch the ledger-keyed filenames only with a reviewed migration plan.
const frozenDuplicatePrefixes = new Map([
  ["0037", ["0037_concertmaster_report_goal_uniqueness.sql", "0037_metronome_challenge_idempotency.sql"]],
  ["0038", ["0038_certification_report_hardening.sql", "0038_goal_actual_costs.sql"]],
  ["0075", ["0075_ipython_session_journal.sql", "0075_ipython_session_journal_hardening.sql"]],
  ["0077", ["0077_capability_repetition_effect_index.sql", "0077_metronome_below_requirement_routing.sql"]],
]);

const files = readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const byPrefix = new Map();
for (const file of files) {
  const match = /^(\d+)_/.exec(file);
  if (match === null) {
    console.error(`Migration filename missing numeric prefix: ${file}`);
    process.exit(1);
  }
  const prefix = match[1];
  byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), file]);
}

let failed = false;
for (const [prefix, names] of byPrefix) {
  const frozen = frozenDuplicatePrefixes.get(prefix);
  if (names.length > 1 && frozen === undefined) {
    console.error(`Duplicate migration prefix ${prefix}: ${names.join(", ")}`);
    failed = true;
  } else if (frozen !== undefined && (names.length !== frozen.length || !frozen.every((name) => names.includes(name)))) {
    console.error(`Frozen duplicate prefix ${prefix} changed (expected ${frozen.join(", ")}, found ${names.join(", ")})`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log(
  `Migration numbering OK: ${files.length} files, ${byPrefix.size} unique prefixes (${frozenDuplicatePrefixes.size} frozen duplicates).`,
);
