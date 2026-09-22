import type { ProviderAccountLoginStatus } from "@maestro/contracts";

const PROVIDER_AUTH_HOSTS = ["auth.openai.com", "chatgpt.com", "claude.ai"] as const;

export function isProviderAuthUrlAllowed(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && PROVIDER_AUTH_HOSTS.some((host) => url.hostname === host);
  } catch {
    return false;
  }
}

export type ProviderAccountLoginStatusReader = (loginId: string) => Promise<ProviderAccountLoginStatus>;

export async function waitForProviderAccountLogin(
  readStatus: ProviderAccountLoginStatusReader,
  loginId: string,
  options: { intervalMs?: number; maxAttempts?: number; signal?: AbortSignal } = {},
): Promise<ProviderAccountLoginStatus> {
  const intervalMs = options.intervalMs ?? 1000;
  const maxAttempts = options.maxAttempts ?? 90;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (options.signal?.aborted) throw new DOMException("Provider account login was cancelled", "AbortError");
    const status = await readStatus(loginId);
    if (status.state !== "pending") {
      if (status.state === "succeeded") return status;
      throw new Error(status.message ?? `Provider account login ${status.state}`);
    }
    if (attempt + 1 < maxAttempts && intervalMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, intervalMs);
        options.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("Provider account login was cancelled", "AbortError"));
        }, { once: true });
      });
    }
  }
  throw new Error("Provider account login timed out. Try again.");
}
