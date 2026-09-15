import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import type { ApiClient } from "@maestro/api-client";
import type { WebContents } from "electron";
import { loadConnectionConfig, saveConnectionConfig, clearConnectionConfig, type ConnectionConfig } from "./store.js";
import { loadPreferences, savePreferences } from "./preferences.js";
import { createBridgedApi, isExposedMethod } from "./apiBridge.js";
import { EVENT_STREAM_CHANNELS, pumpEventStream, type EventStreamMessage } from "./event-stream-bridge.js";

const dirName = dirname(fileURLToPath(import.meta.url));

// ponytail: Linux only exposes safeStorage's real OS-keychain backend when a secret-service daemon
// (gnome-keyring, kwallet) is running. Most Linux desktops have one; headless/minimal ones (this
// sandbox included) don't. "basic" makes Chromium's OSCrypt encrypt with its own key instead of
// failing closed outright — still far better than plaintext, just not OS-keychain-grade on those
// machines. Upgrade path: detect isEncryptionAvailable() gaps and only then fall back to "basic".
if (process.platform === "linux") app.commandLine.appendSwitch("password-store", "basic");

let api: ApiClient | undefined;
type EventStreamSender = Pick<WebContents, "isDestroyed" | "send" | "once">;
const activeEventStreams = new Map<string, { sender: EventStreamSender; controller: AbortController }>();

function stopEventStreamsForSender(sender: EventStreamSender): void {
  for (const [streamId, active] of activeEventStreams) {
    if (active.sender !== sender) continue;
    active.controller.abort();
    activeEventStreams.delete(streamId);
  }
}

function stopAllEventStreams(): void {
  for (const active of activeEventStreams.values()) active.controller.abort();
  activeEventStreams.clear();
}

function sendEventStreamMessage(sender: EventStreamSender, streamId: string, message: EventStreamMessage): void {
  if (!sender.isDestroyed()) sender.send(EVENT_STREAM_CHANNELS.message, streamId, message);
}

function connect(config: ConnectionConfig | undefined): void {
  stopAllEventStreams();
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

  ipcMain.on(EVENT_STREAM_CHANNELS.start, (event, streamId: unknown, query: unknown) => {
    if (typeof streamId !== "string" || streamId.length === 0) return;
    const existing = activeEventStreams.get(streamId);
    if (existing !== undefined) {
      sendEventStreamMessage(event.sender, streamId, {
        kind: "error",
        message: existing.sender === event.sender ? "Event stream is already active" : "Event stream ownership conflict",
      });
      return;
    }
    const client = api;
    if (client === undefined) {
      sendEventStreamMessage(event.sender, streamId, { kind: "error", message: "Not connected to a control plane yet" });
      return;
    }
    const controller = new AbortController();
    const sender = event.sender;
    activeEventStreams.set(streamId, { sender, controller });
    sender.once("destroyed", () => stopEventStreamsForSender(sender));
    void pumpEventStream(
      (eventQuery, options) => client.streamEvents(eventQuery, options),
      query as Parameters<ApiClient["streamEvents"]>[0],
      controller.signal,
      (message) => {
        const active = activeEventStreams.get(streamId);
        if (active?.sender !== sender || active.controller !== controller) return;
        sendEventStreamMessage(sender, streamId, message);
      },
    ).finally(() => {
      const active = activeEventStreams.get(streamId);
      if (active?.controller === controller) activeEventStreams.delete(streamId);
    });
  });

  ipcMain.on(EVENT_STREAM_CHANNELS.stop, (event, streamId: unknown) => {
    if (typeof streamId !== "string") return;
    const active = activeEventStreams.get(streamId);
    if (active?.sender !== event.sender) return;
    active.controller.abort();
    activeEventStreams.delete(streamId);
  });

  ipcMain.handle("maestro:api", async (_event, method: string, args: unknown[]) => {
    if (!isExposedMethod(method)) throw new Error(`Method not exposed to the renderer: ${method}`);
    if (method === "streamEvents") throw new Error("Use the dedicated durable event stream bridge");
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
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription) =>
    console.log("[did-fail-load]", errorCode, errorDescription),
  );
  window.webContents.on("render-process-gone", (_event, details) => console.log("[render-process-gone]", details));

  const devServerUrl = process.env["MAESTRO_CARNEGIE_DEV_SERVER_URL"];
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
