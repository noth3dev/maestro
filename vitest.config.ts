import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Multiple integration suites intentionally reset tables they manage in
    // their own beforeAll/beforeEach hooks against ONE shared disposable
    // PostgreSQL database (see findings.md's cross-suite retention_class
    // defect). Running test files as separate parallel workers races those
    // resets against whichever other suite happens to be reading or writing
    // the same underlying tables at that moment. Serializing file execution
    // keeps every real-PostgreSQL run deterministic.
    fileParallelism: false,
  },
});
