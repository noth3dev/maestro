#!/usr/bin/env node
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { readFileSync, realpathSync } from "node:fs";
import { openExternalUrl } from "./external-url.js";
import { ApiError, createApiClient, type GoalEvent, type GoalResult } from "@maestro/api-client";
import { startInteractiveTui } from "./tui/entry.js";
import { resolveConnection } from "./tui/connection.js";
import { resolveLocalConnection } from "./tui/local-bootstrap.js";
import type { CertifyWorkerInput } from "@maestro/contracts";

export interface CliIo {
  fetch?: typeof globalThis.fetch;
  /** Opens a provider-owned login URL without passing account secrets through argv. */
  openExternalUrl?: (url: string) => Promise<void>;
  /** Copies a provider-owned login URL without passing it through a shell or argv. */
  copyToClipboard?: (text: string) => Promise<void>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Reads a secret without echoing it; primarily supplied by tests or embedding hosts. */
  readSecret?: (prompt: string) => Promise<string>;
  startTui?: (cwd: string, env: Env, io: CliIo) => Promise<number>;
}

type Env = Record<string, string | undefined>;

export async function executeCli(args: string[], env: Env, io: CliIo): Promise<number> {
  if (args.includes("--help") || args[0] === "help") {
    io.stdout(helpText());
    return 0;
  }
  if (args[0] === "--version" || args[0] === "-V") {
    io.stdout("maestro development\n");
    return 0;
  }
  if (args.length === 0) {
    return (io.startTui ?? ((cwd, environment, tuiIo) => startInteractiveTui({ cwd, env: environment, io: tuiIo })))(process.cwd(), env, io);
  }
  try {
    const connection = await resolveCliConnection(env, io.fetch);
    const baseUrl = connection.apiUrl;
    const token = connection.token;
    const parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        "project-id": { type: "string" },
        "operator-id": { type: "string" },
        "roles-json": { type: "string" },
        "goal-id": { type: "string" },
        "conversation-id": { type: "string" },
        model: { type: "string" },
        text: { type: "string" },
        message: { type: "string" },
        "command-id": { type: "string" },
        "contract-id": { type: "string" },
        "substance-json": { type: "string" },
        "activation-json": { type: "string" },
        "council-json": { type: "string" },
        "brief-json": { type: "string" },
        "packet-json": { type: "string" },
        "plan-json": { type: "string" },
        "bundle-json": { type: "string" },
        "worker-json": { type: "string" },
        "worker-id": { type: "string" },
        "repository-path": { type: "string" },
        "branch-name": { type: "string" },
        "base-revision": { type: "string" },
        "worktree-path": { type: "string" },
        "certification-json": { type: "string" },
        "certification-kind": { type: "string" },
        "review-json": { type: "string" },
        "finding-ids": { type: "string" },
        "evidence-references": { type: "string" },
        "capability-kind": { type: "string" },
        "session-id": { type: "string" },
        "full-access-mode": { type: "string" },
        "correlation-id": { type: "string" },
        kind: { type: "string" },
        "media-type": { type: "string" },
        "content-base64": { type: "string" },
        "content-file": { type: "string" },
        "challenge-id": { type: "string" },
        "correction-request": { type: "string" },
        reason: { type: "string" },
        "plan-version": { type: "string" },
        "department-id": { type: "string" },
        "item-id": { type: "string" },
        "council-id": { type: "string" },
        "content-hash": { type: "string" },
        "expires-at": { type: "string" },
        action: { type: "string" },
        target: { type: "string" },
        "budget-effect-cents": { type: "string" },
        version: { type: "string" },
        "expected-version": { type: "string" },
        "outside-evidence": { type: "boolean", default: false },
        "preview-needed": { type: "boolean", default: false },
        to: { type: "string" },
        after: { type: "string" },
        json: { type: "boolean", default: false },
      },
    });
    const client = createApiClient({ baseUrl, token, ...(io.fetch === undefined ? {} : { fetch: io.fetch }) });
    let [resource, action] = parsed.positionals;
    if (resource === "model") resource = "models";
    if (resource === "models" && action === undefined) action = "list";
    if (parsed.positionals.length > 2) throw new Error("Unexpected positional argument");
    const value = (name: keyof typeof parsed.values) => parsed.values[name];
    const string = (name: keyof typeof parsed.values) => requiredOption(value(name), `--${name}`);
    const json = parsed.values.json === true;

    if (resource === "admin" && action === "project-access") {
      const result = await client.provisionProjectAccess({ operatorId: string("operator-id"), projectId: string("project-id"), roles: parseJsonOption(string("roles-json"), "--roles-json") });
      printState(io.stdout, result, json);
      return 0;
    }

    if (resource === "task-contract" && action === "create") {
      const result = await client.createTaskContract({ projectId: string("project-id"), substance: parseJsonOption(string("substance-json"), "--substance-json") }, string("contract-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "task-contract" && action === "get") {
      const result = await client.getTaskContract(string("contract-id"), { projectId: string("project-id") });
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "task-contract" && action === "amend") {
      const expectedVersion = nonNegativeInteger(string("expected-version"), "--expected-version");
      const result = await client.updateTaskContract(string("contract-id"), { projectId: string("project-id"), expectedVersion, substance: parseJsonOption(string("substance-json"), "--substance-json") }, value("command-id") === undefined ? undefined : string("command-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "task-contract" && action === "select-roles") {
      const result = await client.selectOvertureRoles(string("contract-id"), { projectId: string("project-id"), outsideEvidenceRequested: value("outside-evidence") === true, previewNeeded: value("preview-needed") === true }, value("command-id") === undefined ? undefined : string("command-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "task-contract" && action === "confirm") {
      const version = nonNegativeInteger(string("version"), "--version");
      await client.confirmTaskContract(string("contract-id"), { projectId: string("project-id"), version, contentHash: string("content-hash") }, value("command-id") === undefined ? undefined : string("command-id"));
      printState(io.stdout, { confirmed: true }, json);
      return 0;
    }
    if (resource === "task-contract" && action === "launch") {
      const result = await client.launchTaskContract(string("contract-id"), string("project-id"), value("command-id") === undefined ? undefined : string("command-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "login" && action === "openai-codex") {
      const login = await client.startAccountLogin();
      if (!json) io.stdout(`Opening ChatGPT account login in your browser: ${login.authUrl}\n`);
      try { await (io.openExternalUrl ?? openExternalUrl)(login.authUrl); } catch { if (!json) io.stdout(`If the browser did not open, visit: ${login.authUrl}\n`); }
      const timeoutMs = Number(env.MAESTRO_LOGIN_TIMEOUT_MS ?? "120000");
      const pollMs = Number(env.MAESTRO_LOGIN_POLL_MS ?? "500");
      const deadline = Date.now() + (Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120_000);
      let status = await client.accountLoginStatus(login.loginId);
      while (status.state === "pending" && Date.now() < deadline) {
        await new Promise<void>((resolve) => setTimeout(resolve, Number.isFinite(pollMs) && pollMs >= 0 ? pollMs : 500));
        status = await client.accountLoginStatus(login.loginId);
      }
      if (status.state === "succeeded") { if (!json) io.stdout(`Account login complete: ${login.providerId}\n`); printState(io.stdout, { providerId: login.providerId, loginId: login.loginId, state: status.state }, json); return 0; }
      if (status.state === "pending") throw new Error("Provider account login timed out");
      throw new Error(status.message ?? `Provider account login ${status.state}`);
    }

    if (resource === "login" && (action === "openai" || action === "anthropic")) {
      const secret = await (io.readSecret ?? ((prompt) => readSecretFromStdin(io, prompt)))(`${action} API key`);
      const result = await client.loginProvider({ providerId: action, authMode: "api-key", secret });
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "logout" && action === "openai-codex") {
      await client.logoutAccount();
      printState(io.stdout, { providerId: action, revoked: true }, json);
      return 0;
    }

    if (resource === "logout" && (action === "openai" || action === "anthropic")) {
      await client.logoutProvider(action);
      printState(io.stdout, { providerId: action, revoked: true }, json);
      return 0;
    }

    if (resource === "models" && action === "list") {
      const result = await client.listModels();
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "conversation" && action === "create") {
      const result = await client.createConversation({ projectId: string("project-id"), goalId: string("goal-id"), model: string("model") });
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "conversation" && action === "get") {
      const result = await client.getConversation(string("conversation-id"), { projectId: string("project-id") });
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "conversation" && action === "turn") {
      const result = await client.sendConversationTurn(string("conversation-id"), { projectId: string("project-id"), text: string("text") });
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "conversation" && action === "cancel") {
      const result = await client.cancelConversation(string("conversation-id"), { projectId: string("project-id") });
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "goals" && action === "list") {
      const result = await client.listGoals(string("project-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "budget" && action === "get") {
      const result = await client.getBudgetSummary(string("goal-id"), { projectId: string("project-id") });
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "head" && action === "activate") {
      const result = await client.activateHead(string("goal-id"), parseJsonOption(string("activation-json"), "--activation-json"), string("command-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "council" && action === "create") {
      const result = await client.createCouncil(string("goal-id"), parseJsonOption(string("council-json"), "--council-json"), string("command-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "council" && action === "get") {
      const result = await client.getCouncil(string("council-id"), string("project-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "council" && action === "submit-brief") {
      await client.submitCouncilBrief(string("council-id"), string("department-id"), parseJsonOption(string("brief-json"), "--brief-json"), string("command-id"));
      printState(io.stdout, { submitted: true }, json);
      return 0;
    }
    if (resource === "council" && action === "reveal") {
      await client.revealCouncil(string("council-id"), string("project-id"), string("command-id"));
      printState(io.stdout, { revealed: true }, json);
      return 0;
    }
    if (resource === "council" && action === "decide") {
      const result = await client.decideCouncil(string("council-id"), parseJsonOption(string("packet-json"), "--packet-json"), string("command-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "department-plan" && action === "create") {
      const result = await client.createDepartmentPlan(string("council-id"), string("department-id"), parseJsonOption(string("plan-json"), "--plan-json"), string("command-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "department-plan" && action === "get") {
      const result = await client.getDepartmentPlan(string("council-id"), string("department-id"), string("project-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "mission-bundle" && action === "create") {
      const result = await client.createMissionBundle(string("council-id"), string("department-id"), string("item-id"), parseJsonOption(string("bundle-json"), "--bundle-json"), string("command-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "encore" && action === "review") {
      const result = await client.runEncoreReview(string("goal-id"), { ...parseJsonOption(string("review-json"), "--review-json"), projectId: string("project-id") }, string("command-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "metronome" && action === "scan") {
      const result = await client.scanMetronome(string("goal-id"), { projectId: string("project-id") }, string("command-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "metronome" && action === "challenge") {
      const result = await client.raiseMetronomeChallenge(string("goal-id"), { projectId: string("project-id"), findingIds: parseJsonOption(string("finding-ids"), "--finding-ids"), reason: string("reason"), evidenceReferences: parseJsonOption(string("evidence-references"), "--evidence-references") }, string("command-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "metronome" && action === "correct") {
      const result = await client.requestMetronomeCorrection(string("challenge-id"), { projectId: string("project-id"), correctionRequest: string("correction-request") }, string("command-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "metronome" && action === "safe-pause") {
      const result = await client.requestMetronomeSafePause(string("goal-id"), string("challenge-id"), { projectId: string("project-id") }, string("command-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "metronome" && action === "resolve") {
      const result = await client.resolveMetronomeChallenge(string("challenge-id"), { projectId: string("project-id"), reason: string("reason") }, string("command-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "git" && action === "goal-branch") {
      const result = await client.createGoalIntegrationBranch(string("goal-id"), { projectId: string("project-id"), repositoryPath: string("repository-path"), branchName: string("branch-name"), baseRevision: string("base-revision") }, string("command-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "git" && action === "department-branch") {
      const result = await client.createDepartmentBranch(string("council-id"), string("department-id"), { projectId: string("project-id") }, string("command-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "git" && action === "worker-worktree") {
      const result = await client.createWorkerWorktree(string("worker-id"), { projectId: string("project-id"), worktreePath: string("worktree-path") }, string("command-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "git" && action === "worker-advance") {
      const result = await client.advanceWorkerIntegration(string("worker-id"), { projectId: string("project-id"), message: string("message"), evidenceReferences: parseJsonOption(string("evidence-references"), "--evidence-references") }, string("command-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "git" && action === "goal-revision") {
      const result = await client.freezeGoalIntegrationRevision(string("goal-id"), { projectId: string("project-id") }, string("command-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "git" && action === "status") {
      const result = await client.getGitIntegrationState(string("goal-id"), { projectId: string("project-id") });
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "workers" && action === "list") {
      const result = await client.listWorkersForGoal(string("goal-id"), { projectId: string("project-id") });
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "improvement-digests" && action === "list") {
      const result = await client.listImprovementDigestsForGoal(string("goal-id"), { projectId: string("project-id") });
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "worker" && action === "spawn") {
      const result = await client.spawnWorker(string("council-id"), string("department-id"), parseJsonOption(string("worker-json"), "--worker-json"), string("command-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "worker" && action === "message") {
      const result = await client.sendWorkerMessage(string("worker-id"), { projectId: string("project-id"), message: string("message") }, string("command-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "worker" && action === "get") {
      const result = await client.getWorker(string("worker-id"), string("project-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "worker" && action === "accept") {
      const result = await client.acceptWorker(string("worker-id"), { projectId: string("project-id"), reason: string("reason") }, string("command-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "worker" && (action === "certify" || action === "certify-conditional")) {
      const certification = parseJsonOption<Omit<CertifyWorkerInput, "projectId">>(string("certification-json"), "--certification-json");
      const input = { ...certification, projectId: string("project-id") };
      const result = action === "certify"
        ? await client.certifyWorker(string("worker-id"), input, string("command-id"))
        : await client.certifyConditionalWorker(string("worker-id"), string("certification-kind") as "security" | "safety_compliance", input, string("command-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "worker" && (action === "observe" || action === "cancel")) {
      const input = { projectId: string("project-id") };
      const result = action === "observe"
        ? await client.observeWorker(string("worker-id"), input, string("command-id"))
        : await client.cancelWorker(string("worker-id"), input, string("command-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "mission-bundle" && action === "get") {
      const result = await client.getMissionBundle(string("council-id"), string("department-id"), Number(string("plan-version")), string("item-id"), string("project-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "department-plan" && action === "revise") {
      const result = await client.reviseDepartmentPlan(string("council-id"), string("department-id"), { ...parseJsonOption(string("plan-json"), "--plan-json"), reason: string("reason") }, string("command-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "capability" && action === "select-full-access-mode") {
      const mode = string("full-access-mode");
      if (mode !== "retain_intermediate_approvals" && mode !== "skip_intermediate_approvals") throw new Error("--full-access-mode must be retain_intermediate_approvals or skip_intermediate_approvals");
      const result = await client.selectFullAccessMode(string("goal-id"), { projectId: string("project-id"), capabilityKind: string("capability-kind"), sessionId: string("session-id"), fullAccessMode: mode });
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "critical-action" && action === "request") {
      const result = await client.requestCriticalAction(string("goal-id"), {
        projectId: string("project-id"),
        action: string("action"),
        target: string("target"),
        policyVersion: nonNegativeInteger(string("version"), "--version"),
        budgetEffectCents: safeInteger(string("budget-effect-cents"), "--budget-effect-cents"),
      }, string("command-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "critical-action" && action === "approve-and-run") {
      const expiresAt = string("expires-at");
      const result = await client.approveAndRunCriticalAction(string("goal-id"), {
        projectId: string("project-id"),
        action: string("action"),
        target: string("target"),
        policyVersion: nonNegativeInteger(string("version"), "--version"),
        budgetEffectCents: safeInteger(string("budget-effect-cents"), "--budget-effect-cents"),
        expiresAt,
      }, string("command-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "goal" && action === "create") {
      const contractId = value("contract-id");
      const result = await client.createGoal({ projectId: string("project-id"), ...(contractId === undefined ? {} : { contractId: string("contract-id") }) }, string("command-id"));
      printGoal(io.stdout, result, json);
      return 0;
    }
    if (resource === "goal" && action === "get") {
      const result = await client.getGoal(string("goal-id"), { projectId: string("project-id") });
      printGoal(io.stdout, result, json);
      return 0;
    }
    if (resource === "goal" && action === "transition") {
      const expectedVersion = nonNegativeInteger(string("expected-version"), "--expected-version");
      const result = await client.transitionGoal(string("goal-id"), { projectId: string("project-id"), expectedVersion, to: string("to") as GoalResult["state"] }, string("command-id"));
      printGoal(io.stdout, result, json);
      return 0;
    }
    if (resource === "goal" && (action === "pause" || action === "stop" || action === "resume" || action === "emergency-stop")) {
      const input = { projectId: string("project-id"), expectedVersion: nonNegativeInteger(string("expected-version"), "--expected-version") };
      const commandId = string("command-id");
      const result = action === "pause"
        ? await client.pauseGoal(string("goal-id"), input, commandId)
        : action === "stop"
          ? await client.stopGoal(string("goal-id"), input, commandId)
          : action === "resume"
            ? await client.resumeGoal(string("goal-id"), input, commandId)
            : await client.emergencyStopGoal(string("goal-id"), input, commandId);
      printGoal(io.stdout, result, json);
      return 0;
    }
    if (resource === "metronome-challenges" && action === "list") { const result=await client.listMetronomeChallenges(string("goal-id"), { projectId: string("project-id") }); printState(io.stdout,result,json); return 0; }
    if (resource === "encore-council" && action === "list") { const result=await client.listEncoreCouncilRounds(string("goal-id"), { projectId: string("project-id") }); printState(io.stdout,result,json); return 0; }
    if (resource === "certifications" && action === "list") { const result=await client.listCertifications(string("goal-id"), { projectId: string("project-id") }); printState(io.stdout,result,json); return 0; }
    if (resource === "concertmaster-report" && action === "generate") { const result=await client.generateConcertmasterReport(string("goal-id"), { projectId: string("project-id") }, string("command-id")); printState(io.stdout,result,json); return 0; }
    if (resource === "concertmaster-report" && action === "get") { const result=await client.getConcertmasterReport(string("goal-id"), { projectId: string("project-id") }); printState(io.stdout,result,json); return 0; }
    if (resource === "evidence" && action === "capture") {
      const contentFile = value("content-file");
      const contentBase64 = contentFile === undefined ? string("content-base64") : readFileSync(string("content-file")).toString("base64");
      if (contentFile !== undefined && value("content-base64") !== undefined) throw new Error("Use only one of --content-base64 or --content-file");
      const result = await client.captureEvidence(string("goal-id"), { projectId: string("project-id"), correlationId: string("correlation-id"), commandId: string("command-id"), kind: string("kind"), mediaType: string("media-type"), contentBase64 });
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "evidence" && action === "dump") {
      const goalId = string("goal-id");
      const projectId = string("project-id");
      const bundle = await client.getEvidenceBundle(goalId, { projectId });
      const certifications = await client.listCertifications(goalId, { projectId });
      const report = await client.getConcertmasterReport(goalId, { projectId });
      if (report.evidenceBundleId !== bundle.bundleId) throw new Error("Evidence bundle/report identity mismatch");
      printState(io.stdout, { bundle, certifications, report }, json);
      return 0;
    }
    if (resource === "events" && action === "list") {
      const page = await client.listEvents({ projectId: string("project-id"), after: value("after") === undefined ? "0" : string("after") });
      if (json) io.stdout(`${JSON.stringify(page)}\n`);
      else printEvents(io.stdout, page.events, page.nextCursor);
      return 0;
    }
    throw new Error("Usage: maestro login openai|anthropic|logout openai|anthropic|models list|goal create|get|transition|pause|stop|resume|emergency-stop|head activate|council create|get|submit-brief|reveal|decide|department-plan create|get|revise|mission-bundle create|get|worker spawn|get|message|observe|cancel|accept|certify|certify-conditional|git goal-branch|department-branch|worker-worktree|worker-advance|goal-revision|metronome scan|challenge|concertmaster-report generate|get|encore review|critical-action request|approve-and-run|capability select-full-access-mode|evidence capture|dump|budget ... | maestro events list ...");
  } catch (error) {
    const message = error instanceof ApiError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : "Command failed";
    io.stderr(`${message}\n`);
    return error instanceof ApiError ? 1 : 2;
  }
}

function helpText(): string {
  return `Maestro CLI\n\nConnection (required except help): MAESTRO_API_URL, MAESTRO_API_TOKEN\n\nCommands:\n  login openai|anthropic   (reads API key without echoing it)\n  logout openai|anthropic\n  admin project-access --operator-id --project-id --roles-json\n  goal create|get|transition|pause|stop|resume|emergency-stop\n  models list (also: model list)\n  conversation create|get|turn|cancel\n  goals list\n  budget get\n  task-contract create|get|amend|select-roles|confirm|launch\n  head activate\n  council create|get|submit-brief|reveal|decide\n  department-plan create|get|revise\n  mission-bundle create|get\n  worker spawn|get|observe|cancel|accept|certify|certify-conditional\n  workers list\n  git goal-branch|department-branch|worker-worktree|goal-revision|status\n  metronome scan|challenge\n  metronome-challenges list\n  encore review\n  encore-council list\n  certifications list\n  concertmaster-report generate|get\n  evidence dump\n  improvement-digests list\n  critical-action request|approve-and-run\n  capability select-full-access-mode\n  evidence capture|dump\n  events list\n\nUse --json for machine-readable output.\n`;
}

function nonNegativeInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${option} must be a non-negative integer`);
  return parsed;
}

function safeInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 1_000_000_000) throw new Error(`${option} must be a nonnegative safe integer no greater than 1000000000`);
  return parsed;
}

function parseJsonOption<T extends object = Record<string, unknown>>(value: string, option: string): T {
  try { return JSON.parse(value); } catch { throw new Error(`${option} must contain valid JSON`); }
}

async function readSecretFromStdin(io: CliIo, prompt: string): Promise<string> {
  io.stderr(`${prompt}: `);
  const stdin = process.stdin;
  if (!stdin.isTTY || stdin.setRawMode === undefined) {
    const chunks: Buffer[] = [];
    for await (const chunk of stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    const secret = Buffer.concat(chunks).toString("utf8").split(/\r?\n/, 1)[0] ?? "";
    if (secret.trim() === "") throw new Error("A non-empty provider API key is required");
    return secret.trim();
  }
  return await new Promise<string>((resolve, reject) => {
    let secret = "";
    const cleanup = (): void => {
      stdin.off("data", onData);
      stdin.setRawMode?.(false);
      stdin.pause();
      io.stderr("\n");
    };
    const onData = (chunk: Buffer | string): void => {
      for (const char of String(chunk)) {
        if (char === "\u0003") { cleanup(); reject(new Error("Provider login cancelled")); return; }
        if (char === "\r" || char === "\n") {
          cleanup();
          if (secret.trim() === "") reject(new Error("A non-empty provider API key is required"));
          else resolve(secret.trim());
          return;
        }
        if (char === "\u007f" || char === "\b") secret = secret.slice(0, -1);
        else secret += char;
      }
    };
    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function resolveCliConnection(env: Env, fetch: typeof globalThis.fetch | undefined): Promise<{ apiUrl: string; token: string }> {
  // Keep non-interactive commands explicit when a bearer token is supplied by
  // hand. Bare interactive `maestro` is the path that owns local auto-setup.
  if ((env.MAESTRO_API_URL?.trim() ?? "") === "" && (env.MAESTRO_API_TOKEN?.trim() ?? "") !== "") {
    throw new Error("MAESTRO_API_URL is required");
  }
  const direct = await resolveConnection(env);
  if (direct.kind === "configured") return direct;
  if ((env.MAESTRO_API_URL?.trim() ?? "") !== "" || (env.MAESTRO_API_TOKEN?.trim() ?? "") !== "" || env.MAESTRO_DISABLE_LOCAL_AUTOSTART === "true") {
    throw new Error(direct.reason);
  }
  const local = await resolveLocalConnection({ env, ...(fetch === undefined ? {} : { fetch }) });
  if (local.kind !== "configured") throw new Error(local.reason);
  return local;
}

function requiredOption(value: string | boolean | undefined, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function printGoal(write: CliIo["stdout"], result: GoalResult, json: boolean): void {
  write(json ? `${JSON.stringify(result)}\n` : `Goal ${result.goalId}: ${result.state} (version ${result.version})\n`);
}

function printState(write: CliIo["stdout"], result: unknown, json: boolean): void { write(json ? `${JSON.stringify(result)}\n` : `${JSON.stringify(result)}\n`); }

function printEvents(write: CliIo["stdout"], events: GoalEvent[], nextCursor: string): void {
  if (events.length === 0) write(`Events: 0 (next cursor: ${nextCursor})\n`);
  else for (const event of events) write(`${event.cursor} ${event.eventType} goal=${event.goalId}\n`);
}

export function shouldRunAsMain(moduleUrl: string, argvPath: string | undefined, resolvePath: (path: string) => string = realpathSync): boolean {
  if (argvPath === undefined) return false;
  try {
    return fileURLToPath(moduleUrl) === resolvePath(argvPath);
  } catch {
    return false;
  }
}

if (shouldRunAsMain(import.meta.url, process.argv[1])) {
  void executeCli(process.argv.slice(2), process.env, { fetch: globalThis.fetch, stdout: (text) => process.stdout.write(text), stderr: (text) => process.stderr.write(text) }).then((code) => { process.exitCode = code; });
}
