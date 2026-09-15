import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const operationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../../docs/operations");
const requiredRunbooks = [
  "01-startup.md",
  "02-backup.md",
  "03-restore.md",
  "04-model-outage.md",
  "05-database-failure.md",
  "06-stale-lease.md",
  "07-device-revocation.md",
  "08-discord-silence.md",
  "09-failed-rollout.md",
] as const;

describe("Plan 8 §S6 operator runbook inventory", () => {
  it("provides nine runbooks with an exercise command and evidence marker", () => {
    for (const filename of requiredRunbooks) {
      const path = join(operationsDirectory, filename);
      expect(existsSync(path), filename).toBe(true);
      const content = readFileSync(path, "utf8");
      expect(content, filename).toContain("## Exercise");
      expect(content, filename).toMatch(/`[^`]+`/);
      expect(content, filename).toContain("Evidence:");
    }
  });
});
