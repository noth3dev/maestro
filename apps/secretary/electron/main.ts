import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import type { ApiClient } from "@maestro/api-client";
import { loadConnectionConfig, saveConnectionConfig, clearConnectionConfig, type ConnectionConfig } from "./store.js";
import { loadPreferences, savePreferences } from "./preferences.js";
import { createBridgedApi, isExposedMethod } from "./apiBridge.js";

const dirName = dirname(fileURLToPath(import.meta.url));

// ponytail: Linux only exposes safeStorage's real OS-keychain backend when a secret-service daemon
// (gnome-keyring, kwallet) is running. Most Linux desktops have one; headless/minimal ones (this
// sandbox included) don't. "basic" makes Chromium's OSCrypt encrypt with its own key instead of
// failing closed outright — still far better than plaintext, just not OS-keychain-grade on those
// machines. Upgrade path: detect isEncryptionAvailable() gaps and only then fall back to "basic".
if (process.platform === "linux") app.commandLine.appendSwitch("password-store", "basic");

let api: ApiClient | undefined;

function connect(config: ConnectionConfig | undefined): void {
  api = config === undefined ? undefined : createBridgedApi(config);
}

function registerIpcHandlers(): void {
  ipcMain.handle("maestro:config:get", () => {
    const config = loadConnectionConfig();
    return config === undefined ? undefined : { apiUrl: config.apiUrl, projectId: config.projectId };
  });

  ipcMain.handle("maestro:config:save", (_event, config: ConnectionConfig) => {
    const publicConfig = saveConnectionConfig(config);
    connect(config);
    return publicConfig;
  });

  ipcMain.handle("maestro:config:clear", () => {
    clearConnectionConfig();
    connect(undefined);
  });

  ipcMain.handle("maestro:preferences:get", () => loadPreferences());
  ipcMain.handle("maestro:preferences:save", (_event, preferences: ReturnType<typeof loadPreferences>) => {
    savePreferences(preferences);
  });

  ipcMain.handle("maestro:api", async (_event, method: string, args: unknown[]) => {
    if (!isExposedMethod(method)) throw new Error(`Method not exposed to the renderer: ${method}`);
    if (api === undefined) throw new Error("Not connected to a control plane yet");
    const call = api[method] as (...callArgs: unknown[]) => unknown;
    return call.apply(api, args);
  });
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    webPreferences: {
      preload: join(dirName, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => {
    window.maximize();
    window.show();
  });

  // WSLg (and some other Linux/X11 setups) doesn't report the host's real display scale to
  // Chromium, so content renders at 1x while the rest of the desktop is scaled up — hence "too
  // small". Start bigger by default and let the user fine-tune with the normal browser zoom keys.
  window.webContents.setZoomFactor(1.35);
  window.webContents.on("before-input-event", (_event, input) => {
    if (!input.control || input.type !== "keyDown") return;
    if (input.key === "=" || input.key === "+") window.webContents.setZoomFactor(window.webContents.getZoomFactor() + 0.1);
    else if (input.key === "-") window.webContents.setZoomFactor(Math.max(0.5, window.webContents.getZoomFactor() - 0.1));
    else if (input.key === "0") window.webContents.setZoomFactor(1.35);
  });

  window.webContents.on("console-message", (_event, _level, message) => console.log("[renderer]", message));
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => console.log("[did-fail-load]", errorCode, errorDescription));
  window.webContents.on("render-process-gone", (_event, details) => console.log("[render-process-gone]", details));

  const devServerUrl = process.env["MAESTRO_SECRETARY_DEV_SERVER_URL"];
  if (devServerUrl !== undefined) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(dirName, "..", "renderer", "index.html"));
  }
}

app.whenReady().then(() => {
  connect(loadConnectionConfig());
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
