import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const carnegieScope = "@carnegie/";
const appDirectory = ["apps", "carnegie"].join("/");
const legacyAppDirectory = ["apps", "secretary"].join("/");
const appPackage = ["@maestro", "carnegie"].join("/");
const legacyAppPackage = ["@maestro", "secretary"].join("/");
const appDevServerEnv = ["MAESTRO", "CARNEGIE", "DEV_SERVER_URL"].join("_");
const legacyAppDevServerEnv = ["MAESTRO", "SECRETARY", "DEV_SERVER_URL"].join("_");

function trackedTextFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter((path) => path !== "");
}

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("Maestro product and Carnegie app boundary", () => {
  it("keeps Maestro as the root product and workspace package scope", () => {
    expect(JSON.parse(read("package.json"))).toMatchObject({ name: "maestro" });

    const packageFiles = trackedTextFiles().filter((path) => path.endsWith("package.json") || path.endsWith("package-lock.json"));
    for (const path of packageFiles) expect(readFileSync(path, "utf8"), relative(root, path)).not.toContain(carnegieScope);

    const workspacePackages = trackedTextFiles().filter((path) => path.endsWith("package.json"));
    for (const path of workspacePackages) {
      const pkg = JSON.parse(readFileSync(path, "utf8")) as { name?: string };
      if (pkg.name?.startsWith("@")) expect(pkg.name, relative(root, path)).toMatch(/^@maestro\//);
    }
  });

  it("publishes Maestro as the CLI command and terminal brand", () => {
    const cli = JSON.parse(read("apps/cli/package.json")) as { bin: Record<string, string> };
    expect(cli.bin).toHaveProperty("maestro", "./dist/main.js");
    expect(cli.bin).not.toHaveProperty("carnegie");

    const main = read("apps/cli/src/main.ts");
    expect(main).toContain("Maestro CLI");
    expect(main).toContain("Usage: maestro");
    const shell = read("apps/cli/src/tui/components/shell.ts");
    expect(shell).toContain("MAESTRO");
    expect(shell).not.toContain("CARNEGIE");
  });

  it("moves the desktop app to the Carnegie directory and package", () => {
    expect(existsSync(join(root, appDirectory))).toBe(true);
    expect(existsSync(join(root, legacyAppDirectory))).toBe(false);
    expect(read(`${appDirectory}/package.json`)).toContain(`"name": "${appPackage}"`);
    expect(read(`${appDirectory}/README.md`)).toContain("# Carnegie");
    expect(read(`${appDirectory}/src/index.html`)).toContain("<title>Carnegie</title>");
  });

  it("keeps Maestro identifiers at the Carnegie integration boundary", () => {
    const preload = read(`${appDirectory}/electron/preload.cts`);
    const main = read(`${appDirectory}/electron/main.ts`);
    const globals = read(`${appDirectory}/src/global.d.ts`);
    expect(preload).toContain('contextBridge.exposeInMainWorld("maestroBridge"');
    expect(preload).toContain('ipcRenderer.invoke("maestro:api"');
    expect(main).toContain('ipcMain.handle("maestro:api"');
    expect(globals).toContain("maestro:");
  });

  it("does not leave the old desktop path, package, or development environment behind", () => {
    const textPaths = trackedTextFiles();
    const legacyPathPattern = new RegExp(`${legacyAppDirectory.replace("/", "\\/")}(?=[/\`"' )]|$)`);
    for (const path of textPaths) {
      const text = readFileSync(path, "utf8");
      expect(text, relative(root, path)).not.toMatch(legacyPathPattern);
      expect(text, relative(root, path)).not.toContain(legacyAppPackage);
      expect(text, relative(root, path)).not.toContain(legacyAppDevServerEnv);
    }
    expect(read(`${appDirectory}/electron/main.ts`)).toContain(appDevServerEnv);
    expect(read(`${appDirectory}/scripts/dev.mjs`)).toContain(appDevServerEnv);
  });

  it("keeps MAESTRO environment variables and database compatibility identifiers", () => {
    const env = read(".env.example");
    expect(read(".github/workflows/ci.yml")).toContain("MAESTRO_TEST_DATABASE_URL");
    expect(env).toContain("maestro_test");
    expect(read("packages/local-backend/src/bootstrap/constants.ts")).toContain("maestro_local");
    expect(read(".github/workflows/ci.yml")).toContain("POSTGRES_DB: maestro_test");
  });
});
