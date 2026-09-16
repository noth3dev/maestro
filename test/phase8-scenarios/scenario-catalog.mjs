export const REQUIRED_CHECKPOINT_ID = "phase8-s9-disposable-checkpoint-v1";

export const REQUIRED_RECORD_FIELDS = Object.freeze([
  "actors",
  "models",
  "skills",
  "tools",
  "costs",
  "injectedFailures",
  "durableEvents",
  "durableEvidence",
  "expectedBehavior",
  "observedBehavior",
  "certifications",
  "dissent",
  "limitations",
  "cleanup",
]);

const commonLimitations = Object.freeze([
  "The mapped suites are reusable component evidence, not a complete live end-to-end scenario.",
  "Provider, remote, deployment, payment, and external-send effects remain disabled.",
]);

function scenario(id, name, description, targets, actors, durableEvents, expectedBehavior, extra = {}) {
  return Object.freeze({
    id,
    name,
    description,
    fixtureId: `phase8-s9-${id}-disposable-v1`,
    preconditions: [
      "One frozen candidate identity is recorded before execution.",
      "A disposable project, repository, endpoint, and credentials are used.",
      "The scenario has an explicit cleanup record before any effectful step.",
    ],
    executable: Object.freeze({ command: "npm", args: ["test", "--", "--run", ...targets], targets: Object.freeze([...targets]) }),
    actors: Object.freeze([...actors]),
    models: Object.freeze(["actual model identity is read from runtime evidence; not hardcoded"]),
    skills: Object.freeze(["actual skill grants are read from runtime evidence; not inferred"]),
    tools: Object.freeze(["actual tool calls are read from runtime evidence; not inferred"]),
    costs: Object.freeze({ status: "unobserved-until-live-run", source: "durable runtime evidence" }),
    injectedFailures: Object.freeze([]),
    durableEvents: Object.freeze([...durableEvents]),
    durableEvidence: Object.freeze(["scenario record", "test output", "retained artifact manifest"]),
    expectedBehavior,
    observedBehavior: "unobserved-until-live-run",
    certifications: Object.freeze([]),
    dissent: Object.freeze([]),
    limitations: Object.freeze([...commonLimitations, ...(extra.limitations ?? [])]),
    cleanup:
      "Drop disposable database rows, remove temporary repository/environment/device artifacts, and retain only the evidence manifest.",
    requiredRecordFields: REQUIRED_RECORD_FIELDS,
    liveRequired: true,
  });
}

export const REPRESENTATIVE_SCENARIOS = Object.freeze([
  scenario(
    "01-overture",
    "Overture",
    "Contract intake, role selection, and one explicit launch confirmation.",
    ["apps/control-plane/src/task-contract-api.integration.test.ts", "packages/persistence/src/e2e-goal.integration.test.ts"],
    ["ceo", "concertmaster", "overture"],
    ["task_contract_created", "overture_roles_selected", "launch_confirmation_recorded"],
    "Only needed roles activate, one coherent Task Contract is retained, and no Goal execution starts before confirmation.",
  ),
  scenario(
    "02-hierarchical-execution",
    "Hierarchical execution",
    "Head, Council, Scout, worker, host-tool, Quality, and Concertmaster handoffs.",
    ["apps/control-plane/src/native-worker-acceptance.integration.test.ts", "test/phase6-scenario/full-chain.integration.test.ts"],
    ["concertmaster", "head", "scout", "worker", "quality", "ipython-host"],
    ["head_brief_recorded", "council_decision_recorded", "worker_spawned", "quality_certification_recorded"],
    "Only relevant Heads wake and every handoff is bound to the same Goal and evidence bundle.",
  ),
  scenario(
    "03-head-to-head",
    "Head-to-Head activation",
    "A Head activates another existing Head without duplicate activation.",
    [
      "packages/persistence/src/head-participation.integration.test.ts",
      "apps/control-plane/src/head-participation-api.integration.test.ts",
    ],
    ["concertmaster", "department_head", "encore"],
    ["head_activation_requested", "head_activation_bound", "budget_projection_updated"],
    "The second Head joins the existing Goal context exactly once and the budget/council projection remains scoped.",
    { limitations: ["A dedicated production Head-to-Head runtime seam is not currently exposed by the mapped suite."] },
  ),
  scenario(
    "04-environment-device",
    "Environment and enrolled device",
    "In-scope environment/device use and blocked critical out-of-scope effect.",
    ["packages/persistence/src/phase4-device-live-gate.integration.test.ts", "apps/device-agent/src/main.integration.test.ts"],
    ["worker", "device-agent", "authorized-effect-executor"],
    ["environment_grant_used", "device_grant_checked", "out_of_scope_effect_denied"],
    "In-scope tool use succeeds only inside grant scope; the critical out-of-scope effect is denied before execution.",
  ),
  scenario(
    "05-restart-recovery",
    "Restart recovery",
    "Mid-Goal restart reconciliation with no duplicate effects or stale authority.",
    [
      "test/release-scenario/worker-restart-recovery.integration.test.ts",
      "test/phase7-scenario/cli-parity-and-recovery-proof.integration.test.ts",
    ],
    ["control_plane", "worker", "model_gateway"],
    ["restart_injected", "reconciliation_completed", "accepted_work_recovered"],
    "The durable state reconciles once, fencing rejects stale work, and accepted work is not reported as false success.",
  ),
  scenario(
    "06-discord-incident",
    "Discord incident",
    "Authenticated incident observation, bounded triage, and certification.",
    [
      "apps/discord/src/live-gate.integration.test.ts",
      "apps/control-plane/src/discord-signal-acceptance.integration.test.ts",
      "packages/persistence/src/discord-incident-workflow.integration.test.ts",
    ],
    ["discord-observer", "concertmaster", "incident-head"],
    ["incident_observed", "incident_contract_created", "triage_certified"],
    "A valid incident wakes only the correct Heads, remains bounded, and records the remediation result.",
    {
      limitations: ["Live Discord detection and external delivery are disabled; current evidence uses synthetic or loopback observation."],
    },
  ),
  scenario(
    "07-encore-improvement",
    "Encore improvement",
    "Digest, shadow evaluation, Council judgment, and bounded rollout/rollback.",
    [
      "apps/control-plane/src/encore-acceptance.integration.test.ts",
      "test/phase6-scenario/full-chain.integration.test.ts",
      "test/phase8-routing/routing-hardening-fuzz.test.ts",
    ],
    ["encore", "quality", "council", "rollout-controller"],
    ["digest_curated", "candidate_shadow_evaluated", "council_judged", "rollout_bound"],
    "An improvement is applied only after evidence and Council judgment, and rollback preserves the protected metrics.",
  ),
  scenario(
    "08-portfolio-council",
    "Portfolio Council",
    "Competing Goals, safe pause, resource reallocation, and resume.",
    ["test/phase5-scenario/contention.integration.test.ts"],
    ["encore", "portfolio-council", "affected-heads"],
    ["goals_prioritized", "safe_pause_recorded", "reservation_reallocated", "goal_resumed"],
    "Portfolio decisions remain Goal-scoped and resume does not cross-contaminate evidence or capacity.",
  ),
  scenario(
    "09-ipython-approval",
    "IPython approval gate",
    "Low-risk local execution, multi-tier approvals, repetition scope, and live stop.",
    [
      "packages/agent-runtime/src/ipython-two-stage.test.ts",
      "test/phase8-security/security-adversarial.test.ts",
      "test/release-scenario/critical-action-forbidden-effect.integration.test.ts",
    ],
    ["ipython-host", "department-head", "encore", "user"],
    ["effect_classified", "approval_bound", "repetition_consumed", "stop_recorded"],
    "The host-tool registry and approval ledger enforce the exact Goal, action, scope, and repetition boundary.",
  ),
  scenario(
    "10-critical-gate",
    "Critical gate",
    "Remote push/external send stays blocked until exact CEO approval.",
    ["test/release-scenario/critical-action-forbidden-effect.integration.test.ts", "test/phase8-security/security-adversarial.test.ts"],
    ["concertmaster", "ceo", "authorized-effect-executor"],
    ["critical_action_requested", "approval_checked", "forbidden_effect_denied"],
    "No remote or external effect is invoked without exact approval, and approval cannot expand its target or scope.",
  ),
  scenario(
    "11-radial-app",
    "Radial app",
    "Radial lineage, node actions, avatars, persona, diff, pause, and evidence legibility.",
    [
      "test/phase7-scenario/cli-parity-and-recovery-proof.integration.test.ts",
      "test/phase8-performance/radial-graph-large-portfolio-baseline.integration.test.ts",
    ],
    ["carnegie", "concertmaster", "goal", "head", "worker", "encore", "discord"],
    ["radial_lineage_rendered", "node_actions_scoped", "evidence_remains_legible"],
    "The app projection keeps Concertmaster central and preserves readable scoped lineage without adding a second authority.",
    { limitations: ["This catalog does not claim a full Electron visual, keyboard, screen-reader, or WCAG audit."] },
  ),
]);

export const REQUIRED_SCENARIO_IDS = Object.freeze(REPRESENTATIVE_SCENARIOS.map((scenarioRecord) => scenarioRecord.id));

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireText(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} is required`);
}

function requireStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === ""))
    throw new Error(`${label} must be a string array`);
}

export function validateScenarioReport(report) {
  if (!isRecord(report) || report.schemaVersion !== 1 || !["blocked", "passed", "failed"].includes(report.status))
    throw new Error("invalid scenario report identity");
  requireText(report.candidateId, "candidateId");
  requireText(report.checkpointId, "checkpointId");
  if (report.checkpointId !== REQUIRED_CHECKPOINT_ID) throw new Error("report checkpoint identity is not the canonical S9 checkpoint");
  requireStringArray(report.limitations, "report.limitations");
  if (!Array.isArray(report.scenarios) || report.scenarios.length !== REPRESENTATIVE_SCENARIOS.length)
    throw new Error("report must contain all eleven scenarios");
  const expectedIds = new Set(REQUIRED_SCENARIO_IDS);
  for (const record of report.scenarios) {
    if (!isRecord(record) || !expectedIds.has(record.scenarioId)) throw new Error("report contains an unknown or duplicate scenario");
    expectedIds.delete(record.scenarioId);
    const canonicalScenario = REPRESENTATIVE_SCENARIOS.find((scenarioRecord) => scenarioRecord.id === record.scenarioId);
    if (canonicalScenario === undefined) throw new Error("scenario is not in the canonical catalog");
    if (record.fixtureId !== canonicalScenario.fixtureId) throw new Error("scenario fixture identity does not match the canonical catalog");
    if (record.expectedBehavior !== canonicalScenario.expectedBehavior)
      throw new Error("scenario expected behavior does not match the canonical catalog");
    if (record.cleanup !== canonicalScenario.cleanup) throw new Error("scenario cleanup does not match the canonical catalog");
    if (!["not-run", "blocked", "passed", "failed"].includes(record.status) || typeof record.live !== "boolean")
      throw new Error("scenario status/live boundary is invalid");
    if (record.status === "passed" && record.live !== true) throw new Error("passed scenario evidence must be live");
    if (record.status !== "passed" && record.observedBehavior !== null && typeof record.observedBehavior !== "string")
      throw new Error("observed behavior is invalid");
    for (const field of REQUIRED_RECORD_FIELDS) {
      if (!(field in record)) throw new Error(`scenario record is missing ${field}`);
    }
    for (const field of [
      "actors",
      "models",
      "skills",
      "tools",
      "injectedFailures",
      "durableEvents",
      "durableEvidence",
      "certifications",
      "dissent",
      "limitations",
    ])
      requireStringArray(record[field], `scenario.${field}`);
    if (record.costs !== null && !isRecord(record.costs)) throw new Error("scenario.costs must be an object or null");
    if (
      !isRecord(record.actual) ||
      !Array.isArray(record.actual.actors) ||
      !Array.isArray(record.actual.models) ||
      !Array.isArray(record.actual.skills) ||
      !Array.isArray(record.actual.tools) ||
      (record.actual.costs !== null && !isRecord(record.actual.costs))
    )
      throw new Error("actual runtime record is invalid");
    requireText(record.cleanup, "scenario.cleanup");
    if (record.status === "blocked" && !record.limitations.some((item) => /pending|disabled|unavailable|not.*claim/i.test(item)))
      throw new Error("blocked scenario must explain its limitation");
    if (record.status === "passed") {
      requireStringArray(record.preconditions, "scenario.preconditions");
      if (record.preconditions.length === 0 || typeof record.goalId !== "string" || record.goalId.trim() === "" || typeof record.taskContractVersion !== "string" || record.taskContractVersion.trim() === "")
        throw new Error("passed scenario must include preconditions, Goal identity, and Task Contract version");
      if (
        record.actual.actors.length === 0 ||
        record.actual.models.length === 0 ||
        record.actual.skills.length === 0 ||
        record.actual.tools.length === 0 ||
        record.costs === null
      )
        throw new Error("passed scenario must include actual runtime identities and costs");
      if (
        record.durableEvents.length === 0 ||
        record.durableEvidence.length === 0 ||
        typeof record.observedBehavior !== "string" ||
        record.observedBehavior.trim() === ""
      )
        throw new Error("passed scenario must include observed durable evidence");
    }
  }
  if (expectedIds.size !== 0) throw new Error("report is missing a canonical scenario");
  if (report.status === "blocked" && !report.limitations.some((item) => /pending|disabled|unavailable|not.*claim/i.test(item)))
    throw new Error("blocked report must explain its limitation");
  if (report.status === "passed" && report.scenarios.some((record) => record.status !== "passed"))
    throw new Error("passed report contains incomplete scenarios");
  if (report.status === "passed" && report.scenarios.some((record) => record.live !== true))
    throw new Error("passed report contains non-live evidence");
  return report;
}
