import type { FastifyInstance } from "fastify";
import type { DiscordRouteDeps } from "./deps.js";
import { AuthenticatedDiscordSignalSchema, StoredDiscordSignalSchema } from "@maestro/contracts";
import { parse } from "../server-input.js";

export function registerDiscordRoutes(app: FastifyInstance, deps: DiscordRouteDeps): void {
  const { discordSignal } = deps;
  // Ingests one authenticated Discord watchdog signal. Bearer authentication (above) proves the
  // caller holds a real operator credential; the signal's own HMAC signature (verified inside
  // `discordSignal.record`) additionally proves it was genuinely produced by the configured
  // Discord watchdog source, not merely by any authenticated operator.
  app.post("/v1/discord/signals", async (request, reply) => {
    const input = parse(AuthenticatedDiscordSignalSchema, request.body);
    const stored = await discordSignal.record(input);
    return reply.status(201).send(StoredDiscordSignalSchema.parse(stored));
  });
}
