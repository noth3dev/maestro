import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseConfig, type DiscordConfig } from "./config.js";
import { verifyDiscordSignal, type AuthenticatedDiscordSignal } from "@maestro/domain";
export interface DiscordDelivery { deliver(signal: AuthenticatedDiscordSignal): Promise<void>; }
export interface Discord { readonly config: DiscordConfig; readonly pendingCount: () => number; emit(signal: AuthenticatedDiscordSignal): Promise<void>; flush(): Promise<void>; listen(): Promise<void>; close(): Promise<void>; }
type RecordLine = { readonly kind:"signal"; readonly signal: AuthenticatedDiscordSignal } | { readonly kind:"delivered"; readonly nonce:string };
export function createDiscord(config: DiscordConfig, delivery: DiscordDelivery): Discord {
  const pending = new Map<string, AuthenticatedDiscordSignal>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  let loaded = false;
  let flushing: Promise<void> | undefined;
  let flushRequested = false;

  async function load(): Promise<void> {
    if (loaded) return;
    try {
      const text = await readFile(config.bufferPath, "utf8");
      for (const line of text.split("\n").filter(Boolean)) {
        const entry = JSON.parse(line) as RecordLine;
        if (entry.kind === "signal") pending.set(entry.signal.nonce, entry.signal);
        else pending.delete(entry.nonce);
      }
      loaded = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      loaded = true;
    }
  }

  async function append(entry: RecordLine): Promise<void> {
    await mkdir(dirname(config.bufferPath), { recursive: true });
    await appendFile(config.bufferPath, JSON.stringify(entry) + "\n", "utf8");
  }

  async function flush(): Promise<void> {
    await load();
    if (flushing) {
      flushRequested = true;
      return flushing;
    }
    flushing = (async () => {
      do {
        flushRequested = false;
        for (const [nonce, signal] of [...pending]) {
          try {
            await delivery.deliver(signal);
            await append({ kind: "delivered", nonce });
            pending.delete(nonce);
          } catch {
            // Retain the signal until Maestro is reachable.
          }
        }
      } while (flushRequested && pending.size > 0);
    })().finally(() => {
      flushing = undefined;
    });
    return flushing;
  }

  return {
    config,
    pendingCount: () => pending.size,
    async emit(signal) {
      if (closed) throw new Error("Discord is closed");
      verifyDiscordSignal(signal, config.credential, Date.now(), config.freshnessWindowMs);
      await load();
      if (!pending.has(signal.nonce)) {
        await append({ kind: "signal", signal });
        pending.set(signal.nonce, signal);
      }
      await flush();
    },
    flush,
    async listen() {
      await load();
      if (timer !== undefined) return;
      timer = setInterval(() => { void flush(); }, config.flushIntervalMs);
    },
    async close() {
      if (closed) return;
      closed = true;
      if (timer !== undefined) clearInterval(timer);
      await flush();
    },
  };
}
export async function main(env=process.env): Promise<void> { const discord=createDiscord(parseConfig(env),{deliver:async()=>{throw new Error("No delivery transport configured");}}); await discord.listen(); }
if (import.meta.url===new URL(process.argv[1]!,"file:").href) void main().catch(()=>{process.exitCode=1;});
