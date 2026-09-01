import { z } from "zod";

const environmentSchema = z.object({
  MAESTRO_SECRETARY_API_URL: z.string().url(),
  MAESTRO_SECRETARY_API_TOKEN: z.string().min(1),
  MAESTRO_SECRETARY_PROJECT_ID: z.uuid(),
  MAESTRO_SECRETARY_GOAL_ID: z.uuid(),
});

export interface SecretaryConfig {
  apiUrl: string;
  token: string;
  projectId: string;
  goalId: string;
}

export function parseSecretaryConfig(env: Record<string, string | undefined>): SecretaryConfig {
  const parsed = environmentSchema.safeParse(env);
  if (!parsed.success) throw new Error("Invalid Secretary configuration");
  const url = new URL(parsed.data.MAESTRO_SECRETARY_API_URL);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "::1") {
    throw new Error("Secretary control-plane URL must use a loopback host");
  }
  return { apiUrl: url.href.replace(/\/$/, ""), token: parsed.data.MAESTRO_SECRETARY_API_TOKEN, projectId: parsed.data.MAESTRO_SECRETARY_PROJECT_ID, goalId: parsed.data.MAESTRO_SECRETARY_GOAL_ID };
}

export function publicGoalConfig(config: SecretaryConfig): Omit<SecretaryConfig, "token"> {
  const { token: _token, ...publicConfig } = config;
  return publicConfig;
}
