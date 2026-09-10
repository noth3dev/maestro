import { appendFile, lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { signDiscordSignal } from "../../packages/domain/dist/index.js";

const rootArg = process.argv[2];
if (!rootArg) throw new Error("usage: node seed-incident.mjs <fixture-root> [buffer-path]");
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
  try { if ((await lstat(target)).isSymbolicLink()) throw new Error(`${label} may not be a symlink`); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  return target;
};
const manifestPath = await safePath(join(root, "manifest.json"), "manifest");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const envelopePath = await safePath(join(root, manifest.incident.envelopePath), "incident envelope");
const secretPath = await safePath(join(root, manifest.incident.secretPath), "Discord secret");
const source = JSON.parse(await readFile(envelopePath, "utf8"));
const secret = (await readFile(secretPath, "utf8")).trim();
const refreshedAt = new Date();
const refreshedSignal = { ...source.signal, firstObservedAt: new Date(refreshedAt.getTime() - 1000).toISOString(), lastObservedAt: new Date(refreshedAt.getTime() - 1000).toISOString(), sourceFreshness: new Date(refreshedAt.getTime() - 1000).toISOString() };
const envelope = signDiscordSignal(refreshedSignal, secret, source.nonce, source.sequence, refreshedAt.toISOString());
await writeFile(envelopePath, JSON.stringify(envelope, null, 2) + "\n", "utf8");
manifest.incident.signature = envelope.signature;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
const bufferPath = await safePath(process.argv[3] ?? join(root, "discord-buffer.jsonl"), "buffer");
try {
  const existing = (await readFile(bufferPath, "utf8")).split("\n").filter(Boolean).map(JSON.parse);
  if (existing.some((entry) => entry.kind === "signal" && entry.signal?.nonce === envelope.nonce)) throw new Error(`incident nonce already seeded: ${envelope.nonce}`);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
await appendFile(bufferPath, JSON.stringify({ kind: "signal", signal: envelope }) + "\n", "utf8");
console.log(JSON.stringify({ bufferPath, nonce: envelope.nonce, issuedAt: envelope.issuedAt, seeded: true }));
