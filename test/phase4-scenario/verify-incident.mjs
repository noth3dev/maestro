import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const rootArg = process.argv[2];
if (!rootArg) throw new Error("usage: node verify-incident.mjs <fixture-root> [buffer-path]");
const root = await realpath(resolve(rootArg));
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const testbedRoot = resolve(repoRoot, "testbed");
const inside = (path, parent) => path === parent || path.startsWith(`${parent}${sep}`);
if (inside(root, testbedRoot)) throw new Error("fixture root may not be inside testbed/");
const safePath = async (candidate, label) => {
  const target = resolve(candidate);
  const rel = relative(root, target);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error(`${label} must stay inside fixture root`);
  const parent = await realpath(dirname(target));
  if (!inside(parent, root)) throw new Error(`${label} parent escapes fixture root`);
  if ((await lstat(target)).isSymbolicLink()) throw new Error(`${label} may not be a symlink`);
  return target;
};
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
const bufferPath = await safePath(process.argv[3] ?? join(root, "discord-buffer.jsonl"), "buffer");
const entries = (await readFile(bufferPath, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
const nonce = manifest.incident.nonce;
const delivered = entries.filter((entry) => entry.kind === "delivered" && entry.nonce === nonce);
const signalRecords = entries.filter((entry) => entry.kind === "signal" && entry.signal.nonce === nonce);
if (signalRecords.length !== 1) throw new Error(`expected exactly one signal record for ${nonce}, found ${signalRecords.length}`);
if (delivered.length !== 1) throw new Error(`expected exactly one delivered record for ${nonce}, found ${delivered.length}`);
console.log(JSON.stringify({ nonce, deliveredRecords: delivered.length, signalRecords: signalRecords.length }));
