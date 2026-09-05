import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const devServerUrl = "http://127.0.0.1:5173";

// `npx` walks up node_modules/.bin from cwd, so this works whether npm hoisted
// these binaries to the workspace root or kept them local to this app.
function run(bin, args, options = {}) {
  return spawn("npx", [bin, ...args], { cwd: appDir, stdio: "inherit", shell: process.platform === "win32", ...options });
}

async function waitForDevServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(devServerUrl);
      if (response.ok) return;
    } catch {
      // Vite hasn't bound the port yet — keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Vite dev server did not become ready at ${devServerUrl}`);
}

const tsc = run("tsc", ["-b", "."]);
await new Promise((resolve, reject) => {
  tsc.on("exit", (code) => (code === 0 ? resolve(undefined) : reject(new Error(`tsc -b exited with code ${code}`))));
});

const vite = run("vite", []);
await waitForDevServer();

const electron = run("electron", ["."], {
  env: { ...process.env, MAESTRO_SECRETARY_DEV_SERVER_URL: devServerUrl },
});

const shutdown = () => {
  vite.kill();
  electron.kill();
  process.exit(0);
};
electron.on("exit", shutdown);
process.on("SIGINT", shutdown);
