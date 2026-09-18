import type { FastifyInstance } from "fastify";
import type { SettingsRouteDeps } from "./deps.js";
import {
  SettingsReadSchema,
  SettingsPreferencesUpdateSchema,
  SettingsModelPoolUpdateSchema,
  SettingsAuthorityDefaultsUpdateSchema,
} from "@maestro/contracts";
import { parse, requestOperator } from "../server-input.js";
import { DurableStoreUnavailableError } from "../goal-service.js";
import type { OperatorContext } from "@maestro/persistence";

export function registerSettingsRoutes(app: FastifyInstance, deps: SettingsRouteDeps): void {
  const { settingsService } = deps;
  app.get("/v1/settings", async (request, reply) => {
    if (settingsService === undefined) throw new DurableStoreUnavailableError();
    const operatorId = requestOperator(request as { operator?: OperatorContext }).operatorId;
    return reply.status(200).send(SettingsReadSchema.parse(await settingsService.get(operatorId)));
  });
  app.patch("/v1/settings/preferences", async (request, reply) => {
    if (settingsService === undefined) throw new DurableStoreUnavailableError();
    const operatorId = requestOperator(request as { operator?: OperatorContext }).operatorId;
    const patch = parse(SettingsPreferencesUpdateSchema, request.body);
    return reply.status(200).send(SettingsReadSchema.parse(await settingsService.updatePreferences(operatorId, patch)));
  });
  app.patch("/v1/settings/model-pool", async (request, reply) => {
    if (settingsService === undefined) throw new DurableStoreUnavailableError();
    const operatorId = requestOperator(request as { operator?: OperatorContext }).operatorId;
    const patch = parse(SettingsModelPoolUpdateSchema, request.body);
    return reply.status(200).send(SettingsReadSchema.parse(await settingsService.updateModelPool(operatorId, patch)));
  });
  app.patch("/v1/settings/authority-defaults", async (request, reply) => {
    if (settingsService === undefined) throw new DurableStoreUnavailableError();
    const operatorId = requestOperator(request as { operator?: OperatorContext }).operatorId;
    const patch = parse(SettingsAuthorityDefaultsUpdateSchema, request.body);
    return reply.status(200).send(SettingsReadSchema.parse(await settingsService.updateAuthorityDefaults(operatorId, patch)));
  });
}
