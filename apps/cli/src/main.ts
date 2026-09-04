#!/usr/bin/env node
import { parseArgs } from "node:util";
import { ApiError, createApiClient, type GoalEvent, type GoalResult } from "@maestro/api-client";

export interface CliIo {
  fetch?: typeof globalThis.fetch;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
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
  try {
    const baseUrl = requireEnvironment(env, "MAESTRO_API_URL");
    const token = requireEnvironment(env, "MAESTRO_API_TOKEN");
    const parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        "project-id": { type: "string" },
        "operator-id": { type: "string" },
        "roles-json": { type: "string" },
        "goal-id": { type: "string" },
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
    const [resource, action] = parsed.positionals;
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
    if (resource === "git" && action === "goal-revision") {
      const result = await client.freezeGoalIntegrationRevision(string("goal-id"), { projectId: string("project-id") }, string("command-id"));
      printState(io.stdout, result, json);
      return 0;
    }
    if (resource === "worker" && action === "spawn") {
      const result = await client.spawnWorker(string("council-id"), string("department-id"), parseJsonOption(string("worker-json"), "--worker-json"), string("command-id"));
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
      const certification = parseJsonOption(string("certification-json"), "--certification-json");
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
    if (resource === "metronome-challenges" && action === "list") { const result=await client.listMetronomeChallenges(string("goal-id"), { projectId: string("project-id") }); printState(io.stdout,result,json); return 0; }
    if (resource === "encore-council" && action === "list") { const result=await client.listEncoreCouncilRounds(string("goal-id"), { projectId: string("project-id") }); printState(io.stdout,result,json); return 0; }
    if (resource === "certifications" && action === "list") { const result=await client.listCertifications(string("goal-id"), { projectId: string("project-id") }); printState(io.stdout,result,json); return 0; }
    if (resource === "concertmaster-report" && action === "get") { const result=await client.getConcertmasterReport(string("goal-id"), { projectId: string("project-id") }); printState(io.stdout,result,json); return 0; }
    if (resource === "events" && action === "list") {
      const page = await client.listEvents({ projectId: string("project-id"), after: value("after") === undefined ? "0" : string("after") });
      if (json) io.stdout(`${JSON.stringify(page)}\n`);
      else printEvents(io.stdout, page.events, page.nextCursor);
      return 0;
    }
    throw new Error("Usage: maestro admin project-access|goals list|goal create|get|transition|head activate|council create|get|submit-brief|reveal|decide|department-plan create|get|revise|mission-bundle create|get|worker spawn|get|observe|cancel|accept|certify|certify-conditional|git goal-branch|git department-branch|worker-worktree|goal-revision|metronome scan|metronome challenge|encore review|critical-action approve-and-run|budget ... | maestro events list ...");
  } catch (error) {
    const message = error instanceof ApiError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : "Command failed";
    io.stderr(`${message}\n`);
    return error instanceof ApiError ? 1 : 2;
  }
}

function helpText(): string {
  return `Maestro CLI\n\nConnection (required except help): MAESTRO_API_URL, MAESTRO_API_TOKEN\n\nCommands:\n  admin project-access --operator-id --project-id --roles-json\n  goal create|get|transition\n  goals list\n  budget get\n  task-contract create|get|amend|select-roles|confirm|launch\n  head activate\n  council create|get|submit-brief|reveal|decide\n  department-plan create|get|revise\n  mission-bundle create|get\n  worker spawn|get|observe|cancel|accept|certify|certify-conditional\n  git goal-branch|department-branch|worker-worktree|goal-revision\n  metronome scan|challenge\n  encore review\n  critical-action approve-and-run\n  events list\n\nUse --json for machine-readable output.\n`;
}

function nonNegativeInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${option} must be a non-negative integer`);
  return parsed;
}

function safeInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${option} must be a safe integer`);
  return parsed;
}

function parseJsonOption(value: string, option: string): any {
  try { return JSON.parse(value); } catch { throw new Error(`${option} must contain valid JSON`); }
}

function requireEnvironment(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
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

if (import.meta.url === new URL(process.argv[1]!, "file:").href) {
  void executeCli(process.argv.slice(2), process.env, { fetch: globalThis.fetch, stdout: (text) => process.stdout.write(text), stderr: (text) => process.stderr.write(text) }).then((code) => { process.exitCode = code; });
}
