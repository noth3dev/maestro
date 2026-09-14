/* global require, setTimeout, console, clearTimeout, process */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { app, BrowserWindow } = require("electron");

app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-dev-shm-usage");

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    // The production window remains sandboxed. This smoke harness disables the renderer sandbox only
    // because this container's Electron sandbox exits before console IPC can report the DOM probe.
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  const timeout = setTimeout(() => {
    console.error("Electron radial renderer smoke timed out");
    app.exit(1);
  }, 15000);
  window.webContents.on("console-message", (_event, _level, message) => {
    if (!message.startsWith("RADIAL_SMOKE:")) return;
    clearTimeout(timeout);
    console.log(message);
    app.exit(message.includes('"pass":true') ? 0 : 1);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error(`Electron radial renderer exited: ${JSON.stringify(details)}`);
    clearTimeout(timeout);
    app.exit(1);
  });
  try {
    await window.loadURL(process.env.MAESTRO_RADIAL_SMOKE_URL);
  } catch (error) {
    clearTimeout(timeout);
    console.error(error);
    app.exit(1);
  }
});
