import type { Component } from "@earendil-works/pi-tui";
import { renderDecisionRegion, renderStatusRegion, type SplashController, type TuiShellState } from "./shell.js";

type RegionRenderer = (width: number) => readonly string[];

/** A live TUI region that stays outside the scrollable stream. */
export function createDynamicRegion(renderer: RegionRenderer): Component {
  return {
    render: (width) => [...renderer(width)],
    invalidate: () => undefined,
  };
}

export function createStatusRegion(options: {
  readonly state: TuiShellState;
  readonly height: () => number;
  readonly splash: SplashController;
}): Component {
  return createDynamicRegion((width) => {
    const canShowSplash = width >= 100 && options.height() >= 28;
    const setupVisible = (options.state.setupSteps?.length ?? 0) > 0 && options.state.connection.kind !== "connected";
    const showSplash = canShowSplash && !setupVisible && options.state.connection.kind === "connected" && options.splash.visible();
    const lines = renderStatusRegion(options.state, width, options.height(), { showSplash });
    // Consume the first-frame splash even when the terminal is too small to show it.
    if (options.splash.visible() && !setupVisible) options.splash.dismiss();
    return lines;
  });
}

export function createDecisionRegion(options: {
  readonly state: TuiShellState;
  readonly height: () => number;
}): Component {
  return createDynamicRegion((width) => renderDecisionRegion(options.state, width, options.height()));
}
