export const DEFAULT_ZOOM_FACTOR = 2.5;

export function zoomFactorAfterInput(current: number, key: string): number {
  if (key === "=" || key === "+") return current + 0.1;
  if (key === "-") return Math.max(0.5, current - 0.1);
  if (key === "0") return DEFAULT_ZOOM_FACTOR;
  return current;
}

export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ponytail: under WSLg, native BrowserWindow.maximize() is relayed through the Windows host (DWM),
// and on a multi-monitor setup the host can settle the window onto a *different* monitor than the
// one it's actually on — a documented WSLg limitation (microsoft/wslg#924, #1058): a window moved
// by the Windows side isn't tracked by the Linux side, so it snaps back/around on the next update.
// The fix is to never delegate to native maximize/workArea and instead drive the resize ourselves
// (a Linux-side setBounds call), always targeting whichever display the window is *currently* on —
// which stays correct because we're the ones moving it. This compares bounds against a target
// display's full bounds to detect drift, e.g. after the user manually drags an edge.
export function rectFillsDisplay(bounds: WindowRect, displayBounds: WindowRect): boolean {
  return (
    bounds.x === displayBounds.x &&
    bounds.y === displayBounds.y &&
    bounds.width === displayBounds.width &&
    bounds.height === displayBounds.height
  );
}

export interface EdgeMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

// ponytail: WSLg/X11 exposes no _NET_WORKAREA here (verified: `xprop -root _NET_WORKAREA` finds no
// such atom), so there is no reliable way to ask the guest for taskbar-reserved space. The one place
// that number *does* show up correctly is the native maximize() call itself, which is relayed to the
// real Windows host and comes back sized to exclude the taskbar — just possibly on the wrong monitor
// (see rectFillsDisplay above). So we let native maximize() run once, measure how much smaller than
// its display it ended up, and reapply that same margin manually to whichever display we actually
// want to fill. This assumes one consistent taskbar thickness across monitors, which is the common
// case; worst case on an atypical setup is a small unnecessary gap, never covering a real taskbar.
export function marginsFromSettledBounds(settledBounds: WindowRect, settledDisplayBounds: WindowRect): EdgeMargins {
  return {
    left: settledBounds.x - settledDisplayBounds.x,
    top: settledBounds.y - settledDisplayBounds.y,
    right: settledDisplayBounds.x + settledDisplayBounds.width - (settledBounds.x + settledBounds.width),
    bottom: settledDisplayBounds.y + settledDisplayBounds.height - (settledBounds.y + settledBounds.height),
  };
}

export function applyMarginsToDisplay(displayBounds: WindowRect, margins: EdgeMargins): WindowRect {
  return {
    x: displayBounds.x + margins.left,
    y: displayBounds.y + margins.top,
    width: displayBounds.width - margins.left - margins.right,
    height: displayBounds.height - margins.top - margins.bottom,
  };
}

export interface HostScreenInfo {
  bounds: WindowRect;
  workingArea: WindowRect;
}

// ponytail: the most authoritative source for taskbar-reserved space is the Windows host itself —
// queried once via `powershell.exe System.Windows.Forms.Screen.AllScreens` (available through WSL
// interop). Its Bounds/WorkingArea can be in a *different* DPI-virtualized coordinate space than
// Electron's physical-pixel `screen.getAllDisplays()` (PowerShell is not per-monitor-DPI-aware by
// default), so pixel values don't line up 1:1 across the two lists. What does line up is the
// left-to-right, top-to-bottom monitor *arrangement* — both describe the same physical layout — so
// displays are correlated by sorted position, and the reserved space is carried over as a *fraction*
// of that monitor's size (DPI-independent) rather than as raw pixels.
export function marginsForDisplay(
  targetDisplayBounds: WindowRect,
  electronDisplays: WindowRect[],
  hostScreens: HostScreenInfo[],
): EdgeMargins | undefined {
  if (electronDisplays.length !== hostScreens.length || electronDisplays.length === 0) return undefined;
  const sortKey = (rect: WindowRect): number => rect.x * 1_000_000 + rect.y;
  const sortedElectron = [...electronDisplays].sort((a, b) => sortKey(a) - sortKey(b));
  const sortedHost = [...hostScreens].sort((a, b) => sortKey(a.bounds) - sortKey(b.bounds));
  const index = sortedElectron.findIndex((rect) => rect.x === targetDisplayBounds.x && rect.y === targetDisplayBounds.y);
  const host = index === -1 ? undefined : sortedHost[index];
  if (host === undefined) return undefined;
  const { bounds, workingArea } = host;
  if (bounds.width <= 0 || bounds.height <= 0) return undefined;
  const leftFraction = (workingArea.x - bounds.x) / bounds.width;
  const topFraction = (workingArea.y - bounds.y) / bounds.height;
  const rightFraction = (bounds.x + bounds.width - (workingArea.x + workingArea.width)) / bounds.width;
  const bottomFraction = (bounds.y + bounds.height - (workingArea.y + workingArea.height)) / bounds.height;
  return {
    left: Math.round(leftFraction * targetDisplayBounds.width),
    top: Math.round(topFraction * targetDisplayBounds.height),
    right: Math.round(rightFraction * targetDisplayBounds.width),
    bottom: Math.round(bottomFraction * targetDisplayBounds.height),
  };
}
