export const DEFAULT_ZOOM_FACTOR = 1.6;

export function zoomFactorAfterInput(current: number, key: string): number {
  if (key === "=" || key === "+") return current + 0.1;
  if (key === "-") return Math.max(0.5, current - 0.1);
  if (key === "0") return DEFAULT_ZOOM_FACTOR;
  return current;
}
