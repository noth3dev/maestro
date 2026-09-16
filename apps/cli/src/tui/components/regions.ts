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
    const canShowSplash = width >= 40 && options.height() >= 16;
    const setupVisible = options.state.connection.kind !== "connected";
    const setupInProgress = options.state.connection.kind === "connecting";
    const showSplash = canShowSplash && !setupVisible && options.state.connection.kind === "connected" && options.splash.visible();
    const lines = renderStatusRegion(options.state, width, options.height(), { showSplash });
    const dashboardStatePending = [options.state.goal, options.state.workers, options.state.budget, options.state.organization].some(
      (value) => value?.kind === "loading",
    );
    // Keep the first-frame splash while initialization or dashboard hydration is
    // still loading. Errors are settled state, so expose the truthful status and
    // recovery regions instead of preserving a permanent home splash. A restored
    // splash remains visible for the frame that follows ctrl+/.
    if (options.splash.visible() && !setupInProgress && !setupVisible && !dashboardStatePending) options.splash.consume();
    return lines;
  });
}

export function createDecisionRegion(options: {
  readonly state: TuiShellState;
  readonly height: () => number;
}): Component {
  return createDynamicRegion((width) => renderDecisionRegion(options.state, width, options.height()));
}
