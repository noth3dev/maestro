#!/usr/bin/env node
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { scenarioReportContentHash, validateScenarioReport } from "../test/phase8-scenarios/scenario-catalog.mjs";

export const REQUIRED_RELEASE_GATES = Object.freeze([
  "phaseExitGates",
  "liveScenarios",
  "zeroCriticalFindings",
  "noncriticalFindingsOwnedScheduled",
  "backupRestore",
  "personaRollback",
  "criticalActionDenial",
  "documentation",
  "councilConfidenceDissent",
]);

function text(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} must be non-empty text`);
  return value.trim();
}
function list(value, name, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.some((item) => typeof item !== "string" || item.trim() === "")) throw new Error(`${name} must be a${allowEmpty ? "" : " non-empty"} string array`);
  return value.map((item) => item.trim());
}
function object(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value;
}
function readGateValues(gates) {
  const input = object(gates, "gates");
  return Object.fromEntries(REQUIRED_RELEASE_GATES.map((gate) => [gate, input[gate] === true]));
}
function validateGateBinding(source, scenarioReport, gates, blockers) {
  const binding = source.gateManifest;
  if (binding === undefined) {
    blockers.push("gate manifest identity and evidence binding is required");
    return;
  }
  try {
    object(binding, "gateManifest");
    if (binding.candidateId !== scenarioReport.candidateId) blockers.push("gate manifest candidateId does not match the frozen scenario candidate");
    if (binding.checkpointId !== scenarioReport.checkpointId) blockers.push("gate manifest checkpointId does not match the scenario checkpoint");
    if (binding.runId !== scenarioReport.runId) blockers.push("gate manifest runId does not match the scenario run");
    const evidence = object(binding.gateEvidence, "gateManifest.gateEvidence");
    for (const gate of REQUIRED_RELEASE_GATES) {
      if (gates[gate] && (typeof evidence[gate] !== "string" || !/^[a-f0-9]{64}$/.test(evidence[gate]))) blockers.push(`gate evidence hash is missing or invalid: ${gate}`);
    }
  } catch (error) { blockers.push(error instanceof Error ? error.message : String(error)); }
}
function noncriticalFindings(value) {
  const findings = value ?? [];
  if (!Array.isArray(findings)) throw new Error("findings.noncritical must be an array");
  return findings.map((finding, index) => {
    const entry = object(finding, `findings.noncritical[${index}]`);
    for (const field of ["owner", "consequence", "deadline"]) text(entry[field], `findings.noncritical[${index}].${field}`);
    return { ...entry, owner: entry.owner.trim(), consequence: entry.consequence.trim(), deadline: entry.deadline.trim() };
  });
}

function metadata(input) {
  const source = object(input.metadata ?? input, "release metadata");
  return {
    supportedScope: list(source.supportedScope, "supportedScope"),
    disabledCapabilities: list(source.disabledCapabilities, "disabledCapabilities"),
    knownLimitations: list(source.knownLimitations, "knownLimitations"),
    costs: object(source.costs, "costs"),
    confidence: text(source.confidence, "confidence"),
    dissent: list(source.dissent ?? [], "dissent", { allowEmpty: true }),
  };
}

function blockedReport(candidateId, scenarioReport, blockers, gates, findings, extra = {}) {
  return {
    schemaVersion: 1,
    status: "blocked",
    recommendation: "do_not_release",
    candidateId,
    scenarioReportStatus: scenarioReport.status,
    gates,
    findings,
    blockers,
    ...extra,
  };
}

export function evaluateReleaseDecision(input) {
  const source = object(input, "release decision input");
  const scenarioReport = object(source.scenarioReport, "scenarioReport");
  validateScenarioReport(scenarioReport);
  const candidateId = text(source.candidateId ?? scenarioReport.candidateId, "candidateId");
  if (candidateId !== scenarioReport.candidateId) throw new Error("candidateId does not match scenario report");
  const gates = readGateValues(source.gates);
  const critical = source.findings?.critical ?? [];
  if (!Array.isArray(critical)) throw new Error("findings.critical must be an array");
  const noncritical = noncriticalFindings(source.findings?.noncritical);
  const blockers = [];
  if (scenarioReport.status !== "passed" || scenarioReport.mode !== "live-disposable" || typeof scenarioReport.runId !== "string" || scenarioReport.runId.trim() === "" || scenarioReport.scenarios.some((scenario) => scenario.status !== "passed" || scenario.live !== true)) blockers.push("S9 live representative scenarios are incomplete or lack a live-disposable run identity");
  if (typeof scenarioReport.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(scenarioReport.contentHash) || scenarioReport.contentHash !== scenarioReportContentHash(scenarioReport)) blockers.push("S9 scenario report content hash is missing or does not match its canonical content");
  if (scenarioReport.scenarios.some((scenario) => scenario.limitations.some((limitation) => /pending|mapped suite|not available|not.*claim/i.test(limitation)))) blockers.push("S9 scenario limitations still deny a complete live-system claim");
  validateGateBinding(source, scenarioReport, gates, blockers);
  for (const gate of REQUIRED_RELEASE_GATES) if (!gates[gate]) blockers.push(`release gate is not demonstrated: ${gate}`);
  if (critical.length > 0) blockers.push(`${critical.length} critical finding(s) remain open; critical findings cannot be waived`);
  if (noncritical.some((finding) => !finding.owner || !finding.consequence || !finding.deadline)) blockers.push("every noncritical finding needs an owner, consequence, and deadline");
  let reportMetadata;
  try {
    reportMetadata = metadata(source);
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }
  if (blockers.length > 0) return blockedReport(candidateId, scenarioReport, blockers, gates, { critical, noncritical }, reportMetadata ? { ...reportMetadata } : {});
  return {
    schemaVersion: 1,
    status: "approved",
    recommendation: "release",
    candidateId,
    scenarioReportStatus: scenarioReport.status,
    gates,
    findings: { critical, noncritical },
    ...reportMetadata,
    scenarioEvidenceHash: scenarioReport.contentHash ?? null,
    dissent: reportMetadata.dissent,
  };
}

async function readJson(path, name) {
  try { return JSON.parse(await readFile(resolve(path), "utf8")); }
  catch (error) { throw new Error(`Could not read ${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
async function writeJson(path, value) {
  const destination = resolve(path);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, destination);
  await chmod(destination, 0o600);
  return destination;
}
function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") { console.error("Usage: node scripts/release-decision.mjs --scenario-report <path> --gate-manifest <path> [--report <path>]"); process.exit(2); }
    if (!["--scenario-report", "--gate-manifest", "--report"].includes(arg)) throw new Error(`Unknown option: ${arg}`);
    const value = argv[++index];
    if (value === undefined || value.startsWith("--")) throw new Error(`${arg} requires a value`);
    result[arg.slice(2).replaceAll("-", "_")] = value;
  }
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.scenario_report || !args.gate_manifest) throw new Error("--scenario-report and --gate-manifest are required");
    const result = evaluateReleaseDecision({ scenarioReport: await readJson(args.scenario_report, "scenario report"), ...(await readJson(args.gate_manifest, "release gate manifest")) });
    if (args.report) await writeJson(args.report, result);
    console.log(JSON.stringify({ status: result.status, recommendation: result.recommendation, candidateId: result.candidateId, reportPath: args.report ? resolve(args.report) : null, blockers: result.blockers ?? [] }));
    process.exitCode = result.status === "approved" ? 0 : 2;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
