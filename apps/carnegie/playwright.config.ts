import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: [/src\/.*\.playwright\.ts$/, /tests\/.*\.spec\.ts$/],
  timeout: 30_000,
  use: { browserName: "chromium", headless: true, baseURL: "http://127.0.0.1:5188" },
  webServer: {
    command: "npx vite --host 127.0.0.1 --port 5188 --strictPort",
    url: "http://127.0.0.1:5188/views/kanban-smoke.html",
    cwd: ".",
    reuseExistingServer: !process.env.CI,
  },
});
