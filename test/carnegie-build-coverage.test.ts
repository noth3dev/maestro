import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Carnegie build coverage", () => {
  it("makes the root build execute the full Carnegie renderer typecheck", async () => {
    const rootPackage = JSON.parse(await readFile(`${root}/package.json`, "utf8")) as { scripts: { build?: string } };
    const carnegiePackage = JSON.parse(await readFile(`${root}/apps/carnegie/package.json`, "utf8")) as { scripts: { build?: string } };

    expect(rootPackage.scripts.build).toContain("npm run typecheck:renderer --workspace @maestro/carnegie");
    expect(carnegiePackage.scripts.build).toContain("npm run typecheck:renderer");
  });
});
