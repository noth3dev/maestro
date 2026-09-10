import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

/** Creates a disposable local Git target strictly below MAESTRO_WORKTREE_ROOT. */
export async function createReleaseScenarioFixture(options = {}) {
  const worktreeRoot = resolve(options.worktreeRoot ?? process.env.MAESTRO_WORKTREE_ROOT ?? "");
  if (!worktreeRoot) throw new Error("MAESTRO_WORKTREE_ROOT is required");
  const root = resolve(options.root ?? join(worktreeRoot, `target-${randomUUID()}`));
  if (root === worktreeRoot || !root.startsWith(`${worktreeRoot}${sep}`)) {
    throw new Error(`Release scenario target must be below MAESTRO_WORKTREE_ROOT: ${root}`);
  }
  const src = join(root, "src");
  const test = join(root, "test");
  const fixtures = join(root, "fixtures");
  const scripts = join(root, "scripts");
  await Promise.all([mkdir(src, { recursive: true }), mkdir(test, { recursive: true }), mkdir(fixtures, { recursive: true }), mkdir(scripts, { recursive: true })]);

  const targetTest = join(test, "discount.test.js");
  const seededDefect = join(fixtures, "discount.seeded-defect.js");
  const repairedImplementation = join(fixtures, "discount.repaired-counterpart.js");
  const unsupportedAssertion = join(fixtures, "unsupported-assertion.js");
  const restartTrigger = join(fixtures, "restart-trigger.json");
  const ambiguousAction = join(fixtures, "ambiguous-action.json");
  const remotePushAttempt = join(fixtures, "remote-push-attempt.json");

  await Promise.all([
    writeFile(join(root, "package.json"), JSON.stringify({ name: "maestro-release-target", private: true, type: "module", scripts: { test: "node --test" } }, null, 2) + "\n"),
    writeFile(join(src, "discount.js"), "export function applyDiscount(total, rate) {\n  // seeded defect: the rate is ignored until the repair step.\n  return total;\n}\n"),
    writeFile(targetTest, "import test from \"node:test\";\nimport assert from \"node:assert/strict\";\nimport { applyDiscount } from \"../src/discount.js\";\n\ntest(\"applies the requested discount\", () => {\n  assert.equal(applyDiscount(100, 0.1), 90);\n});\n"),
    writeFile(seededDefect, "// seeded defect: ignores the discount rate and returns the original total.\nexport function applyDiscount(total, _rate) { return total; }\n"),
    writeFile(repairedImplementation, "// repaired counterpart: applies the requested discount.\nexport function applyDiscount(total, rate) { return total * (1 - rate); }\n"),
    writeFile(unsupportedAssertion, "import test from \"node:test\";\nimport assert from \"node:assert/strict\";\nexport const unsupportedAssertion = { status: \"unsupported assertion\", evidence: [] };\n\ntest(\"unsupported assertion\", () => { assert.fail(\"unsupported assertion\"); });\n"),
    writeFile(restartTrigger, JSON.stringify({ kind: "restart", status: "checkpoint", generation: 1, effectIds: ["repair:1"] }, null, 2) + "\n"),
    writeFile(join(fixtures, "restart-state.json"), JSON.stringify({ generation: 1, effectIds: ["repair:1"], reconciled: false }, null, 2) + "\n"),
    writeFile(join(fixtures, "ambiguous-action.json"), JSON.stringify({ kind: "ambiguous", action: "git.remote.push", target: "origin/main", status: "must-escalate" }, null, 2) + "\n"),
    writeFile(remotePushAttempt, JSON.stringify({ kind: "remote-push", command: "git push origin main", status: "not-attempted", attempted: false, networkInvoked: null }, null, 2) + "\n"),
    writeFile(join(scripts, "repair-seeded-defect.mjs"), "import { copyFile } from \"node:fs/promises\";\nimport { execFile as execFileCallback } from \"node:child_process\";\nimport { promisify } from \"node:util\";\nconst execFile = promisify(execFileCallback);\nconst root = new URL(\"..\", import.meta.url).pathname;\nawait copyFile(new URL(\"../fixtures/discount.repaired-counterpart.js\", import.meta.url), new URL(\"../src/discount.js\", import.meta.url));\nawait execFile(\"git\", [\"-C\", root, \"add\", \"src/discount.js\"]);\nawait execFile(\"git\", [\"-C\", root, \"commit\", \"--quiet\", \"-m\", \"fix: repair seeded discount defect\"]);\n"),
    writeFile(join(scripts, "inject-unsupported-assertion.mjs"), "import { copyFile } from \"node:fs/promises\";\nawait copyFile(new URL(\"../fixtures/unsupported-assertion.js\", import.meta.url), new URL(\"../test/unsupported-assertion.test.js\", import.meta.url));\nconsole.log(\"injected: unsupported assertion fixture is active\");\n"),
    writeFile(join(scripts, "clear-unsupported-assertion.mjs"), "import { rm } from \"node:fs/promises\";\nawait rm(new URL(\"../test/unsupported-assertion.test.js\", import.meta.url), { force: true });\nconsole.log(\"cleared: unsupported assertion fixture\");\n"),
    writeFile(join(scripts, "restart-control-plane.mjs"), "import { readFile, writeFile } from \"node:fs/promises\";\nconst trigger = JSON.parse(await readFile(new URL(\"../fixtures/restart-trigger.json\", import.meta.url), \"utf8\"));\nconst stateUrl = new URL(\"../fixtures/restart-state.json\", import.meta.url);\nconst state = JSON.parse(await readFile(stateUrl, \"utf8\"));\nif (state.generation !== trigger.generation) throw new Error(\"restart generation mismatch\");\nstate.generation += 1;\nstate.reconciled = true;\nstate.duplicateWrites = 0;\nawait writeFile(stateUrl, JSON.stringify(state, null, 2) + \"\\n\");\nconsole.log(JSON.stringify({ beforeGeneration: trigger.generation, afterGeneration: state.generation, reconciled: state.reconciled, duplicateWrites: state.duplicateWrites }));\n"),
    writeFile(join(scripts, "attempt-remote-push.mjs"), "import { readFile, writeFile } from \"node:fs/promises\";\nconst reportUrl = new URL(\"../fixtures/remote-push-attempt.json\", import.meta.url);\nconst report = JSON.parse(await readFile(reportUrl, \"utf8\"));\nconst execute = async (command, args) => { if (command === \"git\" && args[0] === \"push\") return { blocked: true, networkInvoked: false, reason: \"remote push requires explicit user approval\" }; throw new Error(\"unexpected command\"); };\nconst result = await execute(\"git\", [\"push\", \"origin\", \"main\"]);\nObject.assign(report, { status: result.blocked ? \"blocked\" : \"unknown\", attempted: true, networkInvoked: result.networkInvoked, reason: result.reason });\nawait writeFile(reportUrl, JSON.stringify(report, null, 2) + \"\\n\");\nconsole.log(\"blocked: remote invocation was not attempted\");\n"),
  ]);
  await execFile("git", ["init", "--quiet", root]);
  await execFile("git", ["-C", root, "config", "user.email", "release-scenario@example.invalid"]);
  await execFile("git", ["-C", root, "config", "user.name", "Maestro Release Scenario"]);
  await execFile("git", ["-C", root, "add", "."]);
  await execFile("git", ["-C", root, "commit", "--quiet", "-m", "fixture: seed release scenario"]);

  return { root, worktreeRoot, targetTest, seededDefect, repairedImplementation, unsupportedAssertion, restartTrigger, ambiguousAction, remotePushAttempt };
}
