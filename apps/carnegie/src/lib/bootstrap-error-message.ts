export const MAX_BOOTSTRAP_MESSAGE_LENGTH = 512;

export const LONG_BOOTSTRAP_ERROR_SUMMARY =
  "Local setup failed. The diagnostic is too long to display; retry local setup or use Manual connection below.";
export const LOCAL_DATABASE_LOCK_SUMMARY =
  "The local database may be busy or locked. Close other Maestro instances, then retry local setup.";

export function boundBootstrapMessage(message: string): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_BOOTSTRAP_MESSAGE_LENGTH) return normalized;

  const lower = normalized.toLowerCase();
  if (/(database|postgres|pglite)/.test(lower) && /(mutex|lock)/.test(lower)) {
    return LOCAL_DATABASE_LOCK_SUMMARY;
  }
  return LONG_BOOTSTRAP_ERROR_SUMMARY;
}
