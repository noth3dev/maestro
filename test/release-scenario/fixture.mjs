import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

/** Creates only disposable local files; it never invokes a provider or a remote command. */
export async function createReleaseScenarioFixture(options = {}) {
  const root = resolve(options.root ?? join(process.env.MAESTRO_WORKTREE_ROOT ?? join(process.cwd(), ".maestro-release-scenario"), `target-${randomUUID()}`));
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
    writeFile(unsupportedAssertion, "// injectable unsupported assertion for step 8.\nexport const unsupportedAssertion = { status: \"unsupported assertion\", evidence: [] };\n"),
    writeFile(restartTrigger, JSON.stringify({ kind: "restart", status: "pending", instruction: "Restart the disposable control-plane process at step 11." }, null, 2) + "\n"),
    writeFile(ambiguousAction, JSON.stringify({ kind: "ambiguous", action: "git.remote.push", target: "origin/main", status: "must-escalate" }, null, 2) + "\n"),
    writeFile(remotePushAttempt, JSON.stringify({ kind: "remote-push", command: "git push origin main", status: "blocked", networkInvoked: false }, null, 2) + "\n"),
    writeFile(join(scripts, "repair-seeded-defect.mjs"), "import { copyFile } from \"node:fs/promises\";\nimport { execFile as execFileCallback } from \"node:child_process\";\nimport { promisify } from \"node:util\";\nconst execFile = promisify(execFileCallback);\nawait copyFile(new URL(\"../fixtures/discount.repaired-counterpart.js\", import.meta.url), new URL(\"../src/discount.js\", import.meta.url));\nawait execFile(\"git\", [\"-C\", new URL(\"..\", import.meta.url).pathname, \"add\", \"src/discount.js\"]);\nawait execFile(\"git\", [\"-C\", new URL(\"..\", import.meta.url).pathname, \"commit\", \"--quiet\", \"-m\", \"fix: repair seeded discount defect\"]);\n"),
    writeFile(join(scripts, "inject-unsupported-assertion.mjs"), "import { writeFile } from \"node:fs/promises\";\nawait writeFile(new URL(\"../test/unsupported-assertion.test.js\", import.meta.url), \"import test from 'node:test';\\nimport assert from 'node:assert/strict';\\ntest('unsupported assertion', () => assert.fail('unsupported assertion'));\\n\");\n"),
    writeFile(join(scripts, "attempt-remote-push.mjs"), "import { writeFile } from \"node:fs/promises\";\nawait writeFile(new URL(\"../fixtures/remote-push-attempt.json\", import.meta.url), JSON.stringify({ kind: 'remote-push', command: 'git push origin main', status: 'blocked', networkInvoked: false }, null, 2) + '\\n');\nconsole.log('blocked: remote invocation was not attempted');\n"),
  ]);
  await execFile("git", ["init", "--quiet", root]);
  await execFile("git", ["-C", root, "config", "user.email", "release-scenario@example.invalid"]);
  await execFile("git", ["-C", root, "config", "user.name", "Maestro Release Scenario"]);
  await execFile("git", ["-C", root, "add", "."]);
  await execFile("git", ["-C", root, "commit", "--quiet", "-m", "fixture: seed release scenario"]);

  return { root, targetTest, seededDefect, repairedImplementation, unsupportedAssertion, restartTrigger, ambiguousAction, remotePushAttempt };
}
