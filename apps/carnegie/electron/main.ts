import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { app, BrowserWindow, ipcMain, screen, shell } from "electron";
import type { ApiClient } from "@maestro/api-client";
import type { LocalBootstrapStepEvent } from "@maestro/local-backend";
import type { WebContents } from "electron";
import { loadConnectionConfig, saveConnectionConfig, clearConnectionConfig, type ConnectionConfig } from "./store.js";
import { initializeCarnegieConnection } from "./bootstrap.js";
import { isProviderAuthUrlAllowed } from "../src/lib/provider-account-login.js";
import { loadPreferences, savePreferences } from "./preferences.js";
import { createBridgedApi, isExposedMethod } from "./apiBridge.js";
import { invokeWithErrorEnvelope } from "./api-error-bridge.js";
import { EVENT_STREAM_CHANNELS, pumpEventStream, type EventStreamMessage } from "./event-stream-bridge.js";
import { abortAllEventStreams, abortEventStreamsForSender, type ActiveEventStream } from "./event-stream-lifecycle.js";
import {
  applyMarginsToDisplay,
  DEFAULT_ZOOM_FACTOR,
  marginsForDisplay,
  marginsFromSettledBounds,
  rectFillsDisplay,
  zoomFactorAfterInput,
  type EdgeMargins,
  type HostScreenInfo,
  type WindowRect,
} from "./window-settings.js";

const execFileAsync = promisify(execFile);

const dirName = dirname(fileURLToPath(import.meta.url));

// ponytail: Linux only exposes safeStorage's real OS-keychain backend when a secret-service daemon
// (gnome-keyring, kwallet) is running. Most Linux desktops have one; headless/minimal ones (this
// sandbox included) don't. "basic" makes Chromium's OSCrypt encrypt with its own key instead of
// failing closed outright — still far better than plaintext, just not OS-keychain-grade on those
// machines. Upgrade path: detect isEncryptionAvailable() gaps and only then fall back to "basic".
if (process.platform === "linux") app.commandLine.appendSwitch("password-store", "basic");

let api: ApiClient | undefined;
let setupError: string | undefined;
type BootstrapStatus =
  | { phase: "starting"; step?: LocalBootstrapStepEvent }
  | { phase: "ready" }
  | { phase: "setup-required"; reason?: string };
let bootstrapStatus: BootstrapStatus = { phase: "starting" };
type EventStreamSender = Pick<WebContents, "isDestroyed" | "send" | "once" | "removeListener">;
const activeEventStreams = new Map<string, ActiveEventStream>();

function stopEventStreamsForSender(sender: EventStreamSender): void {
  abortEventStreamsForSender(activeEventStreams, sender);
}

function stopAllEventStreams(): void {
  abortAllEventStreams(activeEventStreams);
}

function sendEventStreamMessage(sender: EventStreamSender, streamId: string, message: EventStreamMessage): void {
  if (!sender.isDestroyed()) sender.send(EVENT_STREAM_CHANNELS.message, streamId, message);
}

function connect(config: ConnectionConfig | undefined): void {
  stopAllEventStreams();
  api = config === undefined ? undefined : createBridgedApi(config);
}

function publishBootstrapStatus(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send("maestro:bootstrap-status", bootstrapStatus);
  }
}

async function initializeConnection(): Promise<void> {
  try {
    const result = await initializeCarnegieConnection({
      env: process.env,
      load: loadConnectionConfig,
      save: saveConnectionConfig,
      onStep: (step) => {
        bootstrapStatus = { phase: "starting", step };
        publishBootstrapStatus();
      },
    });
    setupError = result.setupError;
    connect(result.config);
    bootstrapStatus = result.config === undefined ? { phase: "setup-required", ...(result.setupError === undefined ? {} : { reason: result.setupError }) } : { phase: "ready" };
  } catch (error) {
    setupError = error instanceof Error ? error.message : "Could not load the saved connection";
    connect(undefined);
    bootstrapStatus = { phase: "setup-required", reason: setupError };
  }
  publishBootstrapStatus();
}

// ponytail: never delegate maximize to the native call — under WSLg it's relayed through the
// Windows host and can settle the window onto the wrong monitor on multi-display setups (a
// documented WSLg limitation: window moves driven by the host aren't tracked by the Linux side).
// Driving the resize ourselves via setBounds keeps it correct regardless of monitor count/layout,
// because we always target whichever display the window is *currently* on. Getting the *size* right
// (excluding the taskbar) needs a source of truth for reserved space, tried in order:
//  1. Ask the Windows host directly via `powershell.exe` (WSL interop) — authoritative, but its
//     Bounds/WorkingArea can be in a different DPI-virtualized space than Electron's physical pixels,
//     so margins are carried over as a fraction of monitor size, not raw pixels (see marginsForDisplay).
//  2. Electron's own `screen.workArea`, when it actually differs from `bounds` (true on real Windows/
//     macOS/most Linux desktops — WSLg is the outlier that reports no taskbar exclusion at all).
//  3. A one-time heuristic: let native maximize() run, measure how much smaller than its (possibly
//     wrong) display it ended up, and reuse that margin — worst case if all three are unavailable.
const maximizeRestoreBounds = new WeakMap<BrowserWindow, WindowRect>();
let cachedHostScreens: HostScreenInfo[] | "unavailable" | undefined;
let cachedHeuristicMargins: EdgeMargins | undefined;

function isWindowMaximized(window: BrowserWindow): boolean {
  return maximizeRestoreBounds.has(window);
}

function publishWindowState(window: BrowserWindow): void {
  if (!window.isDestroyed()) window.webContents.send("maestro:window-state", isWindowMaximized(window));
}

async function queryHostScreens(): Promise<HostScreenInfo[] | undefined> {
  const script =
    "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | " +
    "Select-Object @{N='BX';E={$_.Bounds.X}},@{N='BY';E={$_.Bounds.Y}},@{N='BW';E={$_.Bounds.Width}},@{N='BH';E={$_.Bounds.Height}}," +
    "@{N='WX';E={$_.WorkingArea.X}},@{N='WY';E={$_.WorkingArea.Y}},@{N='WW';E={$_.WorkingArea.Width}},@{N='WH';E={$_.WorkingArea.Height}} " +
    "| ConvertTo-Json -Compress";
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], { timeout: 3000 });
    const parsed: unknown = JSON.parse(stdout.trim());
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.map((row) => {
      const r = row as Record<string, number>;
      return {
        bounds: { x: r["BX"] ?? 0, y: r["BY"] ?? 0, width: r["BW"] ?? 0, height: r["BH"] ?? 0 },
        workingArea: { x: r["WX"] ?? 0, y: r["WY"] ?? 0, width: r["WW"] ?? 0, height: r["WH"] ?? 0 },
      };
    });
  } catch {
    return undefined;
  }
}

// ponytail: bounds can settle, then get nudged again by a late/stale WSLg configure event (observed
// ~300ms after an otherwise-stable read) — require a solid stretch of no-change, not just one or two
// matching polls, or we risk measuring the taskbar margin against a not-yet-final size.
function waitForBoundsToSettle(window: BrowserWindow, maxWaitMs = 1200, pollMs = 50, requiredStableStreak = 6): Promise<void> {
  return new Promise((resolve) => {
    let lastSeen = JSON.stringify(window.getBounds());
    let stableStreak = 0;
    const startedAt = Date.now();
    const poll = (): void => {
      if (window.isDestroyed()) {
        resolve();
        return;
      }
      const current = JSON.stringify(window.getBounds());
      if (current === lastSeen) stableStreak += 1;
      else {
        stableStreak = 0;
        lastSeen = current;
      }
      if (stableStreak >= requiredStableStreak || Date.now() - startedAt >= maxWaitMs) {
        resolve();
        return;
      }
      setTimeout(poll, pollMs);
    };
    setTimeout(poll, pollMs);
  });
}

async function measureHeuristicMargins(window: BrowserWindow): Promise<EdgeMargins> {
  const before = window.getBounds();
  window.maximize();
  await waitForBoundsToSettle(window);
  const settledBounds = window.getBounds();
  const settledDisplayBounds = screen.getDisplayMatching(settledBounds).bounds;
  window.unmaximize();
  window.setBounds(before);
  return marginsFromSettledBounds(settledBounds, settledDisplayBounds);
}

function taskbarMarginsForDisplaySync(targetDisplayBounds: WindowRect): EdgeMargins | undefined {
  if (cachedHostScreens !== undefined && cachedHostScreens !== "unavailable") {
    const electronDisplays = screen.getAllDisplays().map((display) => display.bounds);
    const margins = marginsForDisplay(targetDisplayBounds, electronDisplays, cachedHostScreens);
    if (margins !== undefined) return margins;
  }
  const workArea = screen.getDisplayMatching(targetDisplayBounds).workArea;
  if (!rectFillsDisplay(workArea, targetDisplayBounds)) return marginsFromSettledBounds(workArea, targetDisplayBounds);
  return cachedHeuristicMargins;
}

async function taskbarMarginsForDisplay(window: BrowserWindow, targetDisplayBounds: WindowRect): Promise<EdgeMargins> {
  if (cachedHostScreens === undefined) cachedHostScreens = (await queryHostScreens()) ?? "unavailable";
  const known = taskbarMarginsForDisplaySync(targetDisplayBounds);
  if (known !== undefined) return known;
  cachedHeuristicMargins ??= await measureHeuristicMargins(window);
  return cachedHeuristicMargins;
}

async function maximizeWindow(window: BrowserWindow): Promise<void> {
  if (isWindowMaximized(window)) return;
  const bounds = window.getBounds();
  const targetDisplayBounds = screen.getDisplayMatching(bounds).bounds;
  // Resolve margins (if needed) before marking the window maximized: the heuristic fallback calls
  // native maximize/unmaximize/setBounds, and marking it maximized first would make the resize-drift
  // listener below misread those intermediate, not-yet-corrected bounds as the user un-maximizing.
  const margins = await taskbarMarginsForDisplay(window, targetDisplayBounds);
  maximizeRestoreBounds.set(window, bounds);
  window.setBounds(applyMarginsToDisplay(targetDisplayBounds, margins));
  publishWindowState(window);
}

function unmaximizeWindow(window: BrowserWindow): void {
  const restoreBounds = maximizeRestoreBounds.get(window);
  if (restoreBounds === undefined) return;
  maximizeRestoreBounds.delete(window);
  window.setBounds(restoreBounds);
  publishWindowState(window);
}

async function toggleMaximizeWindow(window: BrowserWindow): Promise<boolean> {
  if (isWindowMaximized(window)) unmaximizeWindow(window);
  else await maximizeWindow(window);
  return isWindowMaximized(window);
}

function registerIpcHandlers(): void {
  ipcMain.on("maestro:window:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.handle("maestro:window:is-maximized", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return window === null ? false : isWindowMaximized(window);
  });
  ipcMain.handle("maestro:window:toggle-maximize", async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return window === null ? false : toggleMaximizeWindow(window);
  });
  ipcMain.on("maestro:window:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle("maestro:config:get", () => {
    const config = loadConnectionConfig();
    return config === undefined ? undefined : { apiUrl: config.apiUrl, projectId: config.projectId };
  });

  ipcMain.handle("maestro:bootstrap:status", () => bootstrapStatus);

  ipcMain.handle("maestro:provider-auth:open", (_event, value: unknown) => {
    if (typeof value !== "string" || !isProviderAuthUrlAllowed(value)) throw new Error("Provider returned an unsafe authentication URL");
    return shell.openExternal(value);
  });

  ipcMain.handle("maestro:config:error", () => setupError);

  ipcMain.handle("maestro:config:save", (_event, config: ConnectionConfig) => {
    const publicConfig = saveConnectionConfig(config);
    setupError = undefined;
    connect(config);
    bootstrapStatus = { phase: "ready" };
    publishBootstrapStatus();
    return publicConfig;
  });

  ipcMain.handle("maestro:config:clear", () => {
    clearConnectionConfig();
    setupError = "Control Plane connection is not configured";
    connect(undefined);
    bootstrapStatus = { phase: "setup-required", reason: setupError };
    publishBootstrapStatus();
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
    const onDestroyed = (): void => stopEventStreamsForSender(sender);
    const active: ActiveEventStream = {
      sender,
      controller,
      removeLifecycleListener: () => sender.removeListener("destroyed", onDestroyed),
    };
    activeEventStreams.set(streamId, active);
    sender.once("destroyed", onDestroyed);
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
      const current = activeEventStreams.get(streamId);
      if (current?.controller === controller) {
        current.removeLifecycleListener();
        activeEventStreams.delete(streamId);
      }
    });
  });

  ipcMain.on(EVENT_STREAM_CHANNELS.stop, (event, streamId: unknown) => {
    if (typeof streamId !== "string") return;
    const active = activeEventStreams.get(streamId);
    if (active?.sender !== event.sender) return;
    active.controller.abort();
    active.removeLifecycleListener();
    activeEventStreams.delete(streamId);
  });

  ipcMain.handle("maestro:api", (_event, method: string, args: unknown[]) =>
    invokeWithErrorEnvelope(() => {
      if (!isExposedMethod(method)) throw new Error(`Method not exposed to the renderer: ${method}`);
      if (method === "streamEvents") throw new Error("Use the dedicated durable event stream bridge");
      if (api === undefined) throw new Error("Not connected to a control plane yet");
      const call = api[method] as (...callArgs: unknown[]) => unknown;
      return call.apply(api, args);
    }),
  );
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    // ponytail: a frame:false window with the OS drop shadow enabled can render a few pixels beyond
    // its own reported bounds — the classic "frameless maximize gap/overlap" bug class. We size the
    // window ourselves pixel-exactly (see the maximize logic below); disabling the shadow makes the
    // rendered window match that exactly instead of bleeding slightly into whatever's just outside it
    // (e.g. the taskbar when maximized).
    hasShadow: false,
    backgroundColor: "#171614",
    show: false,
    webPreferences: {
      preload: join(dirName, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // The user can still drag an edge to resize out of our simulated maximize; treat that as an
  // implicit restore so the toggle button and isMaximized() stay in sync with what's on screen.
  window.on("resize", () => {
    if (!isWindowMaximized(window)) return;
    const displayBounds = screen.getDisplayMatching(window.getBounds()).bounds;
    const margins = taskbarMarginsForDisplaySync(displayBounds);
    if (margins === undefined) return;
    const expected = applyMarginsToDisplay(displayBounds, margins);
    if (!rectFillsDisplay(window.getBounds(), expected)) {
      maximizeRestoreBounds.delete(window);
      publishWindowState(window);
    }
  });

  window.once("ready-to-show", () => {
    window.once("show", () => {
      maximizeWindow(window);
    });
    window.show();
  });

  // WSLg (and some other Linux/X11 setups) doesn't report the host's real display scale to
  // Chromium, so content renders at 1x while the rest of the desktop is scaled up — hence "too
  // small". Start bigger by default and let the user fine-tune with the normal browser zoom keys.
  window.webContents.setZoomFactor(DEFAULT_ZOOM_FACTOR);
  window.webContents.on("before-input-event", (_event, input) => {
    if (!input.control || input.type !== "keyDown") return;
    const nextZoomFactor = zoomFactorAfterInput(window.webContents.getZoomFactor(), input.key);
    if (nextZoomFactor !== window.webContents.getZoomFactor()) window.webContents.setZoomFactor(nextZoomFactor);
  });

  window.webContents.on("console-message", (_event, _level, message) => console.log("[renderer]", message));
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription) =>
    console.log("[did-fail-load]", errorCode, errorDescription),
  );
  window.webContents.on("render-process-gone", (_event, details) => {
    stopEventStreamsForSender(window.webContents);
    console.log("[render-process-gone]", details);
  });
  window.webContents.on("did-start-navigation", (_event, _url, _isInPlace, isMainFrame) => {
    if (isMainFrame) stopEventStreamsForSender(window.webContents);
  });

  const devServerUrl = process.env["MAESTRO_CARNEGIE_DEV_SERVER_URL"];
  if (devServerUrl !== undefined) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(dirName, "..", "renderer", "index.html"));
  }
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
  void initializeConnection();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
