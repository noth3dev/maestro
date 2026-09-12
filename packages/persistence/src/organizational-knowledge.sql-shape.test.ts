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

  it("binds council author exclusion through SQL parameters", () => {
    const source = readFileSync(fileURLToPath(new URL("./organizational-knowledge.ts", import.meta.url)), "utf8");
    expect(source).not.toContain("b.operator_id IS DISTINCT FROM current.authorOperatorId");
    expect(source).toContain("b.operator_id IS DISTINCT FROM $5::text");
    const migration = readFileSync(fileURLToPath(new URL("../migrations/0087_organizational_knowledge.sql", import.meta.url)), "utf8");
    expect(migration).toContain("b.operator_id IS DISTINCT FROM NEW.author_operator_id::text");
    expect(migration).toContain("a.role_id = NEW.promotion_role_id");
    expect(migration).toContain("INSERT INTO knowledge_proposal_authorizations (revision,");
    const bounds = migration.split("\n").find((line) => line.includes("ADD CONSTRAINT organizational_knowledge_text_bounds CHECK")) ?? "";
    expect((bounds.match(/\(/g) ?? []).length).toBe((bounds.match(/\)/g) ?? []).length);

  });
});
