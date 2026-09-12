import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("organizational knowledge persistence SQL shape", () => {
  it("binds every revision insert column", () => {
    const source = readFileSync(fileURLToPath(new URL("./organizational-knowledge.ts", import.meta.url)), "utf8");
    const columns = source.match(/const COLUMNS = "([^"]+)"/)?.[1]?.split(",").length ?? 0;
    const insertColumns = columns - 1;
    const values = source.match(/INSERT INTO organizational_knowledge \(\$\{INSERT_COLUMNS\}\) VALUES \(([^)]+)\)/)?.[1] ?? "";
    const placeholders = [...values.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
    expect(insertColumns).toBe(32);
    expect(Math.max(...placeholders)).toBe(insertColumns);
    expect(new Set(placeholders).size).toBe(insertColumns);
  });
});
