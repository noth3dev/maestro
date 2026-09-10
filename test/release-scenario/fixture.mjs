import { writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);


export async function assertReleaseScenarioTarget(target, worktreeRoot = process.env.MAESTRO_WORKTREE_ROOT) {
  if (typeof worktreeRoot !== "string" || worktreeRoot.trim() === "") throw new Error("MAESTRO_WORKTREE_ROOT is required");
  const realWorktreeRoot = await realpath(worktreeRoot);
  const realTarget = await realpath(target);
  const rel = relative(realWorktreeRoot, realTarget);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Release scenario target resolves outside MAESTRO_WORKTREE_ROOT: ${realTarget}`);
  return realTarget;
}

/** Creates a disposable local Git target strictly below MAESTRO_WORKTREE_ROOT. */
export async function createReleaseScenarioFixture(options = {}) {
  const configuredWorktreeRoot = options.worktreeRoot ?? process.env.MAESTRO_WORKTREE_ROOT;
  if (typeof configuredWorktreeRoot !== "string" || configuredWorktreeRoot.trim() === "") throw new Error("MAESTRO_WORKTREE_ROOT is required");
  let worktreeRoot;
  try { worktreeRoot = await realpath(configuredWorktreeRoot); } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`MAESTRO_WORKTREE_ROOT must already exist: ${configuredWorktreeRoot}`);
    throw error;
  }
  const root = resolve(options.root ?? join(worktreeRoot, `target-${randomUUID()}`));
  const lexicalRelative = relative(worktreeRoot, root);
  if (root === worktreeRoot || lexicalRelative === "" || lexicalRelative === ".." || lexicalRelative.startsWith(`..${sep}`) || isAbsolute(lexicalRelative)) {
    throw new Error(`Release scenario target must be below MAESTRO_WORKTREE_ROOT: ${root}`);
  }
  const parent = await realpath(dirname(root));
  const parentRelative = relative(worktreeRoot, parent);
  if (parentRelative === ".." || parentRelative.startsWith(`..${sep}`) || isAbsolute(parentRelative)) throw new Error(`Release scenario target parent escapes MAESTRO_WORKTREE_ROOT: ${parent}`);
  try { if ((await lstat(root)).isSymbolicLink()) throw new Error(`Release scenario target cannot be a symlink: ${root}`); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  await mkdir(root, { recursive: true });
  const realRoot = await realpath(root);
  const realRelative = relative(worktreeRoot, realRoot);
  if (realRelative === "" || realRelative === ".." || realRelative.startsWith(`..${sep}`) || isAbsolute(realRelative)) throw new Error(`Release scenario target resolves outside MAESTRO_WORKTREE_ROOT: ${realRoot}`);
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
