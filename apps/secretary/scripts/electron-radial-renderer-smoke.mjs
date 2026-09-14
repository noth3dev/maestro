import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const port = "5187";
const url = `http://127.0.0.1:${port}/views/panels/radial/electron-renderer-smoke.html`;
const appDir = dirname(fileURLToPath(import.meta.url)) + "/..";
const vite = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", port, "--strictPort"], { cwd: appDir, stdio: "inherit" });

let ready = false;
for (let attempt = 0; attempt < 50; attempt += 1) {
  try {
    const response = await fetch(url);
    if (response.ok) { ready = true; break; }
  } catch {
    // Vite is still starting.
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}
if (!ready) {
  vite.kill();
  throw new Error(`Vite did not serve ${url}`);
}

const electron = spawn("npx", ["electron", "scripts/electron-radial-renderer-smoke.cjs"], {
  cwd: appDir,
  env: { ...process.env, MAESTRO_RADIAL_SMOKE_URL: url },
  stdio: "inherit",
});
const exitCode = await new Promise((resolve) => electron.once("exit", (code) => resolve(code ?? 1)));
vite.kill();
process.exit(Number(exitCode));
