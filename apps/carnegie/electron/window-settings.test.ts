import { describe, expect, it } from "vitest";
import {
  applyMarginsToDisplay,
  DEFAULT_ZOOM_FACTOR,
  marginsForDisplay,
  marginsFromSettledBounds,
  rectFillsDisplay,
  zoomFactorAfterInput,
} from "./window-settings.js";

describe("Carnegie window zoom", () => {
  it("starts at a readable default zoom", () => {
    expect(DEFAULT_ZOOM_FACTOR).toBe(2.5);
  });

  it("keeps keyboard zoom behavior and resets to the readable default", () => {
    expect(zoomFactorAfterInput(1.6, "=")).toBeCloseTo(1.7);
    expect(zoomFactorAfterInput(1.6, "+")).toBeCloseTo(1.7);
    expect(zoomFactorAfterInput(1.6, "-")).toBe(1.5);
    expect(zoomFactorAfterInput(0.5, "-")).toBe(0.5);
    expect(zoomFactorAfterInput(2.1, "0")).toBe(2.5);
    expect(zoomFactorAfterInput(1.6, "x")).toBe(1.6);
  });
});

describe("Carnegie manual maximize bounds", () => {
  const monitor1 = { x: 0, y: 0, width: 2880, height: 1800 };
  const monitor2 = { x: 2880, y: 0, width: 1920, height: 1080 };

  it("recognizes bounds that exactly fill the target display, on any monitor", () => {
    expect(rectFillsDisplay(monitor1, monitor1)).toBe(true);
    expect(rectFillsDisplay(monitor2, monitor2)).toBe(true);
  });

  it("rejects bounds from a different monitor, matching the wrong-monitor jump bug", () => {
    expect(rectFillsDisplay(monitor2, monitor1)).toBe(false);
  });

  it("rejects bounds resized away from the display, e.g. after a manual drag-resize", () => {
    expect(rectFillsDisplay({ x: 0, y: 0, width: 1600, height: 900 }, monitor1)).toBe(false);
  });
});

describe("Carnegie taskbar margin measurement", () => {
  const monitor2 = { x: 2880, y: 0, width: 1920, height: 1080 };

  it("derives a bottom-only taskbar margin from a native maximize result", () => {
    const settled = { x: 2880, y: 0, width: 1920, height: 1032 };
    expect(marginsFromSettledBounds(settled, monitor2)).toEqual({ top: 0, right: 0, bottom: 48, left: 0 });
  });

  it("derives zero margins when native maximize exactly filled its display", () => {
    expect(marginsFromSettledBounds(monitor2, monitor2)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("reapplies a measured margin to a different, larger display without covering its taskbar area", () => {
    const monitor1 = { x: 0, y: 0, width: 2880, height: 1800 };
    const margins = { top: 0, right: 0, bottom: 48, left: 0 };
    expect(applyMarginsToDisplay(monitor1, margins)).toEqual({ x: 0, y: 0, width: 2880, height: 1752 });
  });

  it("round-trips: applying a measured margin reproduces bounds that satisfy rectFillsDisplay against the margin-adjusted target", () => {
    const settled = { x: 2880, y: 0, width: 1920, height: 1032 };
    const margins = marginsFromSettledBounds(settled, monitor2);
    const reapplied = applyMarginsToDisplay(monitor2, margins);
    expect(rectFillsDisplay(reapplied, reapplied)).toBe(true);
    expect(reapplied).toEqual(settled);
  });
});

// Real captured data from a WSLg dual-monitor box: `xrandr --listmonitors` reports both displays in
// physical pixels (what Electron's screen module also uses), but `powershell.exe`'s
// [System.Windows.Forms.Screen]::AllScreens is not per-monitor-DPI-aware, so it reports the primary
// display (running at 175% Windows scaling) in a smaller, DPI-virtualized coordinate space — 1646x1029
// instead of the real 2880x1800 — while the secondary (100% scaling) display happens to match exactly.
describe("Carnegie host-screen taskbar margins (real WSLg dual-monitor capture)", () => {
  const electronMonitor1 = { x: 0, y: 0, width: 2880, height: 1800 };
  const electronMonitor2 = { x: 2880, y: 0, width: 1920, height: 1080 };
  const hostScreens = [
    { bounds: { x: 0, y: 0, width: 1646, height: 1029 }, workingArea: { x: 0, y: 0, width: 1646, height: 981 } },
    { bounds: { x: 2880, y: 0, width: 1920, height: 1080 }, workingArea: { x: 2880, y: 0, width: 1920, height: 1032 } },
  ];

  it("scales the DPI-virtualized primary-display margin up to the real physical display size", () => {
    expect(marginsForDisplay(electronMonitor1, [electronMonitor1, electronMonitor2], hostScreens)).toEqual({
      top: 0,
      right: 0,
      bottom: 84,
      left: 0,
    });
  });

  it("carries the 1:1 secondary-display margin through unchanged", () => {
    expect(marginsForDisplay(electronMonitor2, [electronMonitor1, electronMonitor2], hostScreens)).toEqual({
      top: 0,
      right: 0,
      bottom: 48,
      left: 0,
    });
  });

  it("gives up cleanly when the display/host-screen counts don't match", () => {
    expect(marginsForDisplay(electronMonitor1, [electronMonitor1], hostScreens)).toBeUndefined();
  });

  it("gives up cleanly when the target display isn't in the Electron list", () => {
    const unrelated = { x: 9999, y: 9999, width: 100, height: 100 };
    expect(marginsForDisplay(unrelated, [electronMonitor1, electronMonitor2], hostScreens)).toBeUndefined();
  });
});
