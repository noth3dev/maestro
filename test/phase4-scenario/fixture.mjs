import { createHash, createHmac, generateKeyPairSync, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { deriveDiscordIncidentFingerprint, verifyDiscordSignal } from "../../packages/domain/dist/index.js";

const execFile = promisify(execFileCallback);
const SCENARIOS = ["narrow-grant", "incident-under-outage"];
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const TESTBED_ROOT = resolve(REPO_ROOT, "testbed");
const isWithin = (path, parent) => path === parent || path.startsWith(`${parent}${sep}`);
const canonicalJson = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
};
const safeRelative = (root, child) => {
  if (typeof child !== "string" || isAbsolute(child)) throw new Error(`fixture path must be relative: ${child}`);
  const rel = relative(root, resolve(root, child));
  if (rel === ".." || rel.startsWith(`..${sep}`)) throw new Error(`fixture path escapes root: ${child}`);
  return rel;
};
async function existingRealpath(path) {
  let candidate = path;
  while (true) {
    try { return await realpath(candidate); }
    catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw error;
      candidate = parent;
    }
  }
}
async function assertFixturePath(root, child) {
  const rel = safeRelative(root, child);
  const target = resolve(root, rel);
  const parent = await existingRealpath(dirname(target));
  if (!isWithin(parent, root)) throw new Error(`fixture path resolves outside root: ${child}`);
  try {
    if ((await lstat(target)).isSymbolicLink()) throw new Error(`fixture path may not be a symlink: ${child}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return target;
}
const write = (root, rel, content) => writeFile(join(root, rel), content);

async function run(command, args, cwd) {
  await execFile(command, args, { cwd, windowsHide: true });
}

async function createCertificates(root) {
  const dir = join(root, "device");
  await mkdir(dir, { recursive: true });
  await run("openssl", ["genpkey", "-algorithm", "Ed25519", "-out", "issuer-ca-key.pem"] , dir);
  await run("openssl", ["req", "-x509", "-new", "-key", "issuer-ca-key.pem", "-out", "issuer-ca.pem", "-days", "1", "-subj", "/CN=Maestro Phase 4 Ephemeral CA"], dir);
  await run("openssl", ["genpkey", "-algorithm", "Ed25519", "-out", "device-key.pem"], dir);
  await run("openssl", ["req", "-new", "-key", "device-key.pem", "-out", "device.csr.pem", "-subj", "/CN=maestro-phase4-test-device"], dir);
  await run("openssl", ["x509", "-req", "-in", "device.csr.pem", "-CA", "issuer-ca.pem", "-CAkey", "issuer-ca-key.pem", "-CAcreateserial", "-out", "device-cert.pem", "-days", "1"], dir);
  await run("openssl", ["pkey", "-in", "device-key.pem", "-pubout", "-out", "device-public.pem"], dir);
  await rm(join(dir, "device.csr.pem"), { force: true });
  await rm(join(dir, "issuer-ca.srl"), { force: true });
  const publicKey = await readFile(join(dir, "device-public.pem"), "utf8");
  return { publicKey, identityFingerprint: createHash("sha256").update(publicKey.trim(), "utf8").digest("hex") };
}

function incidentEnvelope(secret) {
  const issuedAt = new Date().toISOString();
  const observedAt = new Date(Date.now() - 1000).toISOString();
  const identity = { affectedComponent: "control-plane", source: "phase4-watchdog", evidence: ["control plane unavailable after restart"].map((value) => value.trim().toLowerCase().replace(/\s+/g, " ")).sort() };
  const signal = {
    incidentFingerprint: createHash("sha256").update(canonicalJson(identity)).digest("hex"),
    firstObservedAt: observedAt,
    lastObservedAt: observedAt,
    severity: "critical",
    confidence: 0.99,
    affectedComponent: "control-plane",
    affectedVersion: "phase4-fixture",
    minimalReproductionEvidence: ["control plane unavailable after restart"],
    source: "phase4-watchdog",
    sourceFreshness: observedAt,
    deduplicationRelationship: "new",
    discordHealthState: "healthy",
  };
  const body = { signal, nonce: randomUUID(), sequence: 1, issuedAt };
  return { ...body, signature: createHmac("sha256", secret).update(canonicalJson(body)).digest("hex") };
}

export async function createPhase4ScenarioFixture(options = {}) {
  const root = resolve(options.root ?? join(process.cwd(), `.phase4-scenario-${randomUUID()}`));
  if (isWithin(root, TESTBED_ROOT)) throw new Error("phase4 fixture may not use testbed/");
  try {
    if ((await lstat(root)).isSymbolicLink()) throw new Error("phase4 fixture root may not be a symlink");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const parent = await existingRealpath(dirname(root));
  if (isWithin(parent, TESTBED_ROOT)) throw new Error("phase4 fixture parent may not be inside testbed/");
  await mkdir(root, { recursive: true });
  const realRoot = await realpath(root);
  if (isWithin(realRoot, TESTBED_ROOT)) throw new Error("phase4 fixture resolved into testbed/");
  if ((await readdir(root)).length > 0) throw new Error(`fixture root must be empty: ${root}`);
  const device = await createCertificates(root);
  const issuer = generateKeyPairSync("ed25519");
  const issuerPrivateKey = issuer.privateKey.export({ format: "pem", type: "pkcs8" });
  const issuerPublicKey = issuer.publicKey.export({ format: "pem", type: "spki" });
  await write(root, "device/issuer-signing-key.pem", issuerPrivateKey);
  await write(root, "device/issuer-signing-public.pem", issuerPublicKey);
  await chmod(join(root, "device/issuer-signing-key.pem"), 0o600);
  const secret = `phase4-${randomUUID()}`;
  const incident = incidentEnvelope(secret);
  await write(root, "incident-envelope.json", JSON.stringify(incident, null, 2) + "\n");
  await write(root, "discord-secret.txt", secret + "\n");
  await chmod(join(root, "discord-secret.txt"), 0o600);
  const manifest = {
    format: "maestro.phase4.scenario.v1",
    generatedAt: new Date().toISOString(),
    scenarios: SCENARIOS,
    device: {
      deviceId: `device-${randomUUID()}`,
      displayName: "Phase 4 disposable test device",
      deviceType: "computer",
      publicKey: device.publicKey,
      identityFingerprint: device.identityFingerprint,
      issuerKeyId: `issuer-${randomUUID()}`,
      issuerPublicKey,
      certificatePath: "device/device-cert.pem",
      privateKeyPath: "device/device-key.pem",
      caPath: "device/issuer-ca.pem",
      issuerSigningKeyPath: "device/issuer-signing-key.pem",
    },
    goal: { goalId: `goal-${randomUUID()}`, projectId: "REPLACE_WITH_EXISTING_PROJECT_ID", capabilityKind: "device", expiresInMinutes: 10 },
    incident: { envelopePath: "incident-envelope.json", secretPath: "discord-secret.txt", nonce: incident.nonce, sequence: incident.sequence, signature: incident.signature },
    outOfScopeActions: [
      { scenario: "narrow-grant", capabilityKind: "device", action: "browser.navigate", target: "https://example.invalid" },
      { scenario: "incident-under-outage", capabilityKind: "deployment", action: "git.push", target: "origin/main" },
    ],
    safety: { liveGate: "user-only", testbedTouched: false, generatedPrivateKeysAreEphemeral: true },
  };
  await write(root, "manifest.json", JSON.stringify(manifest, null, 2) + "\n");
  return { root, manifest };
}

export async function assertPhase4ScenarioFixture(root) {
  const resolved = resolve(root);
  if (resolved.includes(`${sep}testbed${sep}`) || resolved.endsWith(`${sep}testbed`)) throw new Error("fixture resolved into testbed/");
  const manifest = JSON.parse(await readFile(join(resolved, "manifest.json"), "utf8"));
  if (manifest.format !== "maestro.phase4.scenario.v1") throw new Error("unsupported phase4 fixture format");
  if (JSON.stringify(manifest.scenarios) !== JSON.stringify(SCENARIOS)) throw new Error("both phase4 scenarios are required");
  const manifestPaths = [
    manifest.device.certificatePath, manifest.device.privateKeyPath, manifest.device.caPath,
    manifest.device.issuerSigningKeyPath, manifest.incident.envelopePath, manifest.incident.secretPath,
  ];
  for (const rel of manifestPaths) {
    const target = await assertFixturePath(resolved, rel);
    await stat(target);
  }
  const envelopePath = await assertFixturePath(resolved, manifest.incident.envelopePath);
  const secretPath = await assertFixturePath(resolved, manifest.incident.secretPath);
  const envelope = JSON.parse(await readFile(envelopePath, "utf8"));
  const secret = (await readFile(secretPath, "utf8")).trim();
  verifyDiscordSignal(envelope, secret, Date.now(), 300_000);
  if (deriveDiscordIncidentFingerprint(envelope.signal) !== envelope.signal.incidentFingerprint) throw new Error("incident fingerprint does not verify");
  if (manifest.incident.nonce !== envelope.nonce || manifest.incident.sequence !== envelope.sequence || manifest.incident.signature !== envelope.signature) {
    throw new Error("manifest incident metadata does not match the authenticated envelope");
  }
  if (manifest.outOfScopeActions.length !== 2) throw new Error("each scenario must include one out-of-scope action");
  return { root: resolved, manifest };
}
