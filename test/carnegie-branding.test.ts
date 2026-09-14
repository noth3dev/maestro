import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const legacyScope = "@ma" + "estro/";
const legacyProduct = ["ma", "estro"].join("");

function textFiles(directory: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (entry === ".git" || entry === "node_modules" || entry === "testbed") continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) result.push(...textFiles(path));
    else result.push(path);
  }
  return result;
}

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("Carnegie product/package rename", () => {
  it("uses the Carnegie root package and workspace scope everywhere", () => {
    const rootPackage = JSON.parse(read("package.json")) as { name: string };
    expect(rootPackage.name).toBe("carnegie");

    const packageFiles = textFiles(root).filter((path) => path.endsWith("package.json") || path.endsWith("package-lock.json"));
    for (const path of packageFiles) expect(readFileSync(path, "utf8"), relative(root, path)).not.toContain(legacyScope);

    const workspacePackages = textFiles(root).filter((path) => path.endsWith("package.json"));
    for (const path of workspacePackages) {
      const pkg = JSON.parse(readFileSync(path, "utf8")) as { name?: string };
      if (pkg.name?.startsWith("@")) expect(pkg.name, relative(root, path)).toMatch(/^@carnegie\//);
    }
  });

  it("publishes Carnegie as the CLI command and terminal brand", () => {
    const cli = JSON.parse(read("apps/cli/package.json")) as { bin: Record<string, string> };
    expect(cli.bin).toHaveProperty("carnegie", "./dist/main.js");
    expect(cli.bin).not.toHaveProperty(legacyProduct);

    const main = read("apps/cli/src/main.ts");
    expect(main).toContain("Carnegie CLI");
    expect(main).toContain("Usage: carnegie");
    expect(main).not.toContain(`${legacyProduct} development`);
    expect(main).not.toContain(`Usage: ${legacyProduct}`);

    const shell = read("apps/cli/src/tui/components/shell.ts");
    expect(shell).toContain("CARNEGIE");
    expect(shell).not.toContain("MAESTRO");
    expect(shell).not.toContain(`"${legacyProduct}"`);
  });

  it("uses Carnegie for Secretary's Electron bridge and IPC surface", () => {
    const preload = read("apps/secretary/electron/preload.cts");
    const main = read("apps/secretary/electron/main.ts");
    const globals = read("apps/secretary/src/global.d.ts");
    expect(preload).toContain('contextBridge.exposeInMainWorld("carnegie"');
    expect(preload).toContain('ipcRenderer.invoke("carnegie:api"');
    expect(main).toContain('ipcMain.handle("carnegie:api"');
    expect(preload).not.toContain(`window.${legacyProduct}`);
    expect(main).not.toContain(`"${legacyProduct}:`);
    expect(globals).toContain("carnegie:");
    expect(globals).not.toContain(`${legacyProduct}:`);
  });

  it("keeps MAESTRO environment variables and database compatibility identifiers", () => {
    const env = read(".env.example");
    expect(read(".github/workflows/ci.yml")).toContain("MAESTRO_TEST_DATABASE_URL");
    expect(env).toContain("maestro_test");
    expect(read("apps/cli/src/tui/local-bootstrap.ts")).toContain("maestro_local");
    expect(read(".github/workflows/ci.yml")).toContain("POSTGRES_DB: maestro_test");
  });

  it("updates the user-facing documentation brand without changing the repository URL", () => {
    for (const path of ["README.md", "CONTRIBUTING.md", "SECURITY.md", "docs/README.md", "docs/en/README.md", "docs/ko/README.md", "roadmap/README.md"]) {
      const content = read(path);
      expect(content, path).toMatch(/Carnegie/);
      expect(content.replace(/https:\/\/github\.com\/noth3dev\/maestro(?:\.git)?/g, "")).not.toMatch(/\bMaestro\b/);
    }
    expect(read("CONTRIBUTING.md")).toContain("https://github.com/noth3dev/maestro.git");
  });
});
