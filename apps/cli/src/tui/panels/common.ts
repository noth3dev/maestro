export type PanelState<T> =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | { kind: "value"; value: T };

export function panelLine(line: string, width: number): string {
  return line.length <= width ? line : `${line.slice(0, Math.max(0, width - 1))}…`;
}
