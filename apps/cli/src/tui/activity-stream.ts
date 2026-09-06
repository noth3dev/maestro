export interface CursorEvent {
  cursor: string;
}

export function mergeEvents<T extends CursorEvent>(existing: readonly T[], incoming: readonly T[]): T[] {
  const cursors = new Set(existing.map((event) => event.cursor));
  return [...existing, ...incoming.filter((event) => !cursors.has(event.cursor))];
}
