import { z } from "zod";
export interface DiscordConfig { readonly bufferPath: string; readonly credential: string; readonly flushIntervalMs: number; readonly freshnessWindowMs: number; readonly targetApiUrl?: string; readonly targetApiToken?: string; }
const schema = z.object({
  DISCORD_BUFFER_PATH: z.string().min(1),
  DISCORD_CREDENTIAL: z.string().min(1),
  DISCORD_FLUSH_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  DISCORD_FRESHNESS_WINDOW_MS: z.coerce.number().int().positive().default(300000),
  DISCORD_TARGET_API_URL: z.string().min(1).optional(),
  DISCORD_TARGET_API_TOKEN: z.string().min(1).optional(),
});
export function parseConfig(env: Record<string,string|undefined>): DiscordConfig {
  const p=schema.safeParse(env);
  if (!p.success) throw new Error("Invalid Discord configuration",{cause:p.error});
  return {
    bufferPath:p.data.DISCORD_BUFFER_PATH,
    credential:p.data.DISCORD_CREDENTIAL,
    flushIntervalMs:p.data.DISCORD_FLUSH_INTERVAL_MS,
    freshnessWindowMs:p.data.DISCORD_FRESHNESS_WINDOW_MS,
    ...(p.data.DISCORD_TARGET_API_URL === undefined ? {} : { targetApiUrl: p.data.DISCORD_TARGET_API_URL }),
    ...(p.data.DISCORD_TARGET_API_TOKEN === undefined ? {} : { targetApiToken: p.data.DISCORD_TARGET_API_TOKEN }),
  };
}
