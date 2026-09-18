import { MouseRegion, type Component, type TuiMouseEvent } from "@earendil-works/pi-tui";

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
