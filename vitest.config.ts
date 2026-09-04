import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@maestro/api-client": new URL("./packages/api-client/src/index.ts", import.meta.url).pathname,
      "@maestro/contracts": new URL("./packages/contracts/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    // Multiple integration suites intentionally reset tables they manage in
    // their own beforeAll/beforeEach hooks against ONE shared disposable
    // PostgreSQL database (see findings.md's cross-suite retention_class
    // defect). Running test files as separate parallel workers races those
    // resets against whichever other suite happens to be reading or writing
    // the same underlying tables at that moment. Serializing file execution
    // keeps every real-PostgreSQL run deterministic.
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"],
    // `.worktrees/*` holds separate git worktrees (other phase branches)
    // nested inside this checkout on disk. Vitest's own default excludes
    // only cover node_modules/dist/.git, not sibling worktree checkouts, so
    // without this a run from the main worktree root would also collect and
    // execute every other worktree's test files against this process's
    // module graph. Exclude them explicitly; each worktree runs its own
    // tests independently from its own directory.
    exclude: ["**/node_modules/**", "**/dist/**", ".git/**", ".worktrees/**"],
  },
});
