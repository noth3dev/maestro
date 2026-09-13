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
    const setupVisible = options.state.connection.kind !== "connected";
    const setupInProgress = options.state.connection.kind === "connecting";
    const showSplash = canShowSplash && !setupVisible && options.state.connection.kind === "connected" && options.splash.visible();
    const lines = renderStatusRegion(options.state, width, options.height(), { showSplash });
    // Do not consume the first-frame splash while initialization is still
    // connecting; setup callbacks can arrive after this first render.
    if (options.splash.visible() && !setupInProgress && !setupVisible) options.splash.dismiss();
    return lines;
  });
}

export function createDecisionRegion(options: {
  readonly state: TuiShellState;
  readonly height: () => number;
}): Component {
  return createDynamicRegion((width) => renderDecisionRegion(options.state, width, options.height()));
}
