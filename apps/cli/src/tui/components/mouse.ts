import { MouseRegion, type Component, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { createDynamicRegion } from "./regions.js";

/**
 * Wrap a component so primary-button clicks invoke `onClick`.
 * pi-tui already pairs press/release into a synthesized `click` event; this
 * helper only forwards that event and returns undefined for everything, so
 * the renderer performs no capture/focus/render side effect and wrapping
 * stays rendering-neutral until a slice supplies a real callback.
 */
export function withClickRegion(child: Component, onClick: (event: TuiMouseEvent) => void): Component {
  return new MouseRegion(child, (event) => {
    if (event.type !== "click") return undefined;
    onClick(event);
    return undefined;
  });
}

/**
 * Recipe for adding mouse support to a TUI surface:
 * 1. Render the surface to plain string lines with an existing `renderX` function.
 * 2. Write a content-search `resolve` mapping region-local `(x, y)` cells to an
 *    action; return undefined for everything unmapped (borders, gaps,
 *    truncated labels) so stray clicks stay no-ops.
 * 3. Handle the action through the same applier the keyboard path uses.
 * pi-tui delivers region-local coordinates, so `resolve` always runs against
 * the lines of the last rendered frame captured below — never fixed offsets.
 */
export function createClickRegion<TAction>(options: {
  lines: (width: number) => readonly string[];
  resolve: (lines: readonly string[], x: number, y: number) => TAction | undefined;
  onAction: (action: TAction) => void;
}): Component {
  let lastWidth = 0;
  const inner = createDynamicRegion((width) => {
    lastWidth = width;
    return [...options.lines(width)];
  });
  return withClickRegion(inner, (event) => {
    if (lastWidth <= 0) return;
    const action = options.resolve(options.lines(lastWidth), event.x, event.y);
    if (action === undefined) return;
    options.onAction(action);
  });
}
