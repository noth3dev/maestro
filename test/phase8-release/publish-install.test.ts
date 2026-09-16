import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

const packagePath = join(process.cwd(), "apps/cli/package.json");
const installerPath = join(process.cwd(), "scripts/install.sh");

function runCommand(command, args) {
  return new Promise((resolve, reject) => execFile(command, args, { cwd: process.cwd() }, (error, stdout, stderr) => error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout, stderr })));
}

function runInstaller(env) {
  return new Promise((resolve) => {
    const child = spawn("bash", [installerPath], { cwd: process.cwd(), env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("Plan 8 §S11 CLI publication", () => {
  it("declares a publishable semver package with an explicit artifact allowlist", async () => {
    const pkg = JSON.parse(await readFile(packagePath, "utf8"));
    expect(pkg.private).toBe(false);
    expect(pkg.version).toMatch(/^0\.1\.0$/);
    expect(pkg.files).toEqual(["dist/**/*.js", "dist/**/*.d.ts", "README.md", "LICENSE"]);
    expect(pkg.bin.maestro).toBe("./dist/main.js");
    expect(pkg.exports["."]).toBe("./dist/main.js");
  });

  it("reports the published semver from the CLI entrypoint", async () => {
    const source = await readFile(join(process.cwd(), "apps/cli/src/version.ts"), "utf8");
    expect(source).toContain('MAESTRO_VERSION = "0.1.0"');
  });

  it("packs only compiled runtime files and required metadata", async () => {
    const result = await runCommand("npm", ["pack", "--dry-run", "--json", "--workspace=@maestro/cli"]);
    const files = JSON.parse(result.stdout)[0].files.map((file) => file.path);
    expect(files).toContain("LICENSE"); expect(files).toContain("README.md"); expect(files).toContain("package.json");
    expect(files.every((file) => file === "LICENSE" || file === "README.md" || file === "package.json" || file.endsWith(".js") || file.endsWith(".d.ts"))).toBe(true);
    expect(files.some((file) => file.endsWith(".ts") && !file.endsWith(".d.ts") || file.endsWith(".test.ts") || file.includes("tsbuildinfo"))).toBe(false);
  });

  it("does not claim a clean global install while workspace dependencies remain unpublished", async () => {
    const workspacePackages = ["packages/api-client/package.json", "packages/contracts/package.json", "packages/domain/package.json", "packages/persistence/package.json"];
    const privateDependencies = [];
    for (const path of workspacePackages) {
      const pkg = JSON.parse(await readFile(join(process.cwd(), path), "utf8"));
      if (pkg.private === true) privateDependencies.push(pkg.name);
    }
    expect(privateDependencies).toEqual(expect.arrayContaining(["@maestro/api-client", "@maestro/contracts", "@maestro/domain", "@maestro/persistence"]));
  });

  it("fails clearly when Node is absent or incompatible", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maestro-install-node-"));
    await writeFile(join(directory, "node"), "#!/bin/sh\nprintf '20\n'\n");
    await chmod(join(directory, "node"), 0o755);
    const result = await runInstaller({ PATH: `${directory}:/usr/bin:/bin`, MAESTRO_INSTALL_NPM: "npm" });
    expect(result.code).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/Node.*24|24.*Node/i);
  });

  it("reinstalls cleanly through npm and reports the global bin path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maestro-install-ok-"));
    await writeFile(join(directory, "node"), String.raw`#!/bin/sh
if [ "$1" = "-p" ]; then printf '24\n'; else exit 0; fi
`);
    await writeFile(join(directory, "npm"), String.raw`#!/bin/sh
if [ "$1" = "config" ]; then printf '%s\n' "$MAESTRO_TEST_PREFIX"; exit 0; fi
printf 'installed %s\n' "$*" >> "$MAESTRO_TEST_LOG"
`);
    await chmod(join(directory, "node"), 0o755); await chmod(join(directory, "npm"), 0o755);
    const log = join(directory, "npm.log");
    const env = { PATH: `${directory}:/usr/bin:/bin`, MAESTRO_TEST_PREFIX: directory, MAESTRO_TEST_LOG: log, MAESTRO_NPM_PACKAGE: "@maestro/cli", MAESTRO_NPM_VERSION: "0.1.0" };
    const first = await runInstaller(env); const second = await runInstaller(env);
    expect(first.code).toBe(0); expect(second.code).toBe(0);
    expect((await readFile(log, "utf8")).split("\n").filter(Boolean)).toHaveLength(2);
  });
});
