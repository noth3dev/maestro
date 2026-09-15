/**
 * Stable dependency token for reads that must follow the durable SSE cursor.
 * Keeping this as a typed seam makes refresh behavior testable without mounting React.
 */
export function durableReadRefreshToken(cursor: string): string {
  return cursor;
}
