import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const carnegieScope = "@carnegie/";

function textFiles(directory: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (entry === ".git" || entry === "node_modules" || entry === "testbed" || entry === ".worktrees") continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) result.push(...textFiles(path));
    else result.push(path);
  }
  return result;
}

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("Maestro product and Carnegie Secretary boundary", () => {
  it("keeps Maestro as the root product and workspace package scope", () => {
    expect(JSON.parse(read("package.json"))).toMatchObject({ name: "maestro" });

    const packageFiles = textFiles(root).filter((path) => path.endsWith("package.json") || path.endsWith("package-lock.json"));
    for (const path of packageFiles) expect(readFileSync(path, "utf8"), relative(root, path)).not.toContain(carnegieScope);

    const workspacePackages = textFiles(root).filter((path) => path.endsWith("package.json"));
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

  it("keeps Maestro identifiers at the Secretary integration boundary", () => {
    const preload = read("apps/secretary/electron/preload.cts");
    const main = read("apps/secretary/electron/main.ts");
    const globals = read("apps/secretary/src/global.d.ts");
    expect(preload).toContain('contextBridge.exposeInMainWorld("maestro"');
    expect(preload).toContain('ipcRenderer.invoke("maestro:api"');
    expect(main).toContain('ipcMain.handle("maestro:api"');
    expect(globals).toContain("maestro:");
    expect(read("apps/secretary/package.json")).toContain('"name": "@maestro/secretary"');
  });

  it("keeps Carnegie as the Secretary desktop app brand", () => {
    expect(read("apps/secretary/README.md")).toContain("# Carnegie");
    expect(read("apps/secretary/src/index.html")).toContain("<title>Carnegie</title>");
  });

  it("keeps MAESTRO environment variables and database compatibility identifiers", () => {
    const env = read(".env.example");
    expect(read(".github/workflows/ci.yml")).toContain("MAESTRO_TEST_DATABASE_URL");
    expect(env).toContain("maestro_test");
    expect(read("apps/cli/src/tui/local-bootstrap.ts")).toContain("maestro_local");
    expect(read(".github/workflows/ci.yml")).toContain("POSTGRES_DB: maestro_test");
  });
});
