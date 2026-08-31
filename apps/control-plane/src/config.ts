import { z } from "zod";

export interface MaestroConfig {
  databaseUrl: string;
  evidenceDir: string;
  host: string;
  port: number;
  primeAgentVersion: string;
}

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  MAESTRO_EVIDENCE_DIR: z.string().min(1),
  MAESTRO_HOST: z.string().default("127.0.0.1"),
  MAESTRO_PORT: z.coerce.number().int().min(1).max(65535).default(4310),
  MAESTRO_ALLOW_REMOTE: z.enum(["true", "false"]).default("false"),
});

export function parseConfig(
  env: Record<string, string | undefined>,
): MaestroConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error("Invalid Maestro configuration", { cause: parsed.error });
  }

  const {
    DATABASE_URL: databaseUrl,
    MAESTRO_EVIDENCE_DIR: evidenceDir,
    MAESTRO_HOST: host,
    MAESTRO_PORT: port,
    MAESTRO_ALLOW_REMOTE: allowRemote,
  } = parsed.data;

  if (host !== "127.0.0.1" && host !== "localhost" && allowRemote !== "true") {
    throw new Error("Remote binding requires explicit MAESTRO_ALLOW_REMOTE=true");
  }

  return { databaseUrl, evidenceDir, host, port, primeAgentVersion: "0.8.0" };
}
