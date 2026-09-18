import type { FastifyInstance } from "fastify";
import type { ProviderRouteDeps } from "./deps.js";
import {
  ProviderCredentialLoginInputSchema,
  ProviderCredentialBindingSchema,
  ProviderAccountLoginStartInputSchema,
  ProviderAccountLoginStartResultSchema,
  ProviderAccountLoginStatusSchema,
} from "@maestro/contracts";
import { parse, requestOperator, RequestValidationError } from "../server-input.js";
import { randomUUID } from "node:crypto";
import { DurableStoreUnavailableError } from "../goal-service.js";
import type { OperatorContext } from "@maestro/persistence";
import { cancelAccountLoginFlow, pollAccountLoginStatus, startAccountLoginFlow } from "../account-login-flow.js";

export function registerProviderRoutes(app: FastifyInstance, deps: ProviderRouteDeps): void {
  const { providerCredentials, accountLoginStore, loginOwnerId, loginOperationStaleAfterMs } = deps;
  app.get("/v1/provider-credentials", async (_request, reply) => {
    if (providerCredentials?.list === undefined) throw new DurableStoreUnavailableError();
    return reply.status(200).send(await providerCredentials.list());
  });

  app.post("/v1/provider-credentials", async (request, reply) => {
    if (!providerCredentials) throw new DurableStoreUnavailableError();
    const input = parse(ProviderCredentialLoginInputSchema, request.body);
    const header = request.headers["idempotency-key"];
    const requestId = typeof header === "string" && header.trim() !== "" ? header : randomUUID();
    const result = await providerCredentials.bind({
      operatorId: requestOperator(request as { operator?: OperatorContext }).operatorId,
      requestId,
      providerId: input.providerId,
      authMode: input.authMode,
      secret: input.secret,
    });
    return reply.status(200).send(ProviderCredentialBindingSchema.parse(result));
  });

  app.post("/v1/provider-account-logins/start", async (request, reply) => {
    const input = parse(ProviderAccountLoginStartInputSchema, request.body);
    if (!providerCredentials?.startAccountLogin || accountLoginStore === undefined) throw new DurableStoreUnavailableError();
    const header = request.headers["idempotency-key"];
    const requestId = typeof header === "string" && header.trim() !== "" ? header : randomUUID();
    const operatorId = requestOperator(request as { operator?: OperatorContext }).operatorId;
    const result = await startAccountLoginFlow(
      { store: accountLoginStore, ownerId: loginOwnerId, staleAfterMs: loginOperationStaleAfterMs },
      { startAccountLogin: providerCredentials.startAccountLogin },
      { operatorId, providerId: input.providerId, requestId },
    );
    return reply.status(200).send(ProviderAccountLoginStartResultSchema.parse(result));
  });

  app.post("/v1/provider-account-logins/logout", async (request, reply) => {
    if (!providerCredentials?.logoutAccount) throw new DurableStoreUnavailableError();
    const input = parse(ProviderAccountLoginStartInputSchema, request.body);
    const header = request.headers["idempotency-key"];
    const requestId = typeof header === "string" && header.trim() !== "" ? header : randomUUID();
    await providerCredentials.logoutAccount({
      operatorId: requestOperator(request as { operator?: OperatorContext }).operatorId,
      requestId,
      providerId: input.providerId,
    });
    return reply.status(200).send({ revoked: true });
  });

  app.post("/v1/provider-account-logins/status", async (request, reply) => {
    if (!providerCredentials?.accountLoginStatus || accountLoginStore === undefined) throw new DurableStoreUnavailableError();
    const body = request.body && typeof request.body === "object" ? (request.body as Record<string, unknown>) : {};
    const input = parse(ProviderAccountLoginStatusSchema.pick({ providerId: true, loginId: true }), body);
    const header = request.headers["idempotency-key"];
    const requestId = typeof header === "string" && header.trim() !== "" ? header : randomUUID();
    const operatorId = requestOperator(request as { operator?: OperatorContext }).operatorId;
    const outcome = await pollAccountLoginStatus(
      { store: accountLoginStore, ownerId: loginOwnerId, staleAfterMs: loginOperationStaleAfterMs },
      { accountLoginStatus: providerCredentials.accountLoginStatus },
      { operatorId, loginId: input.loginId, providerId: input.providerId, requestId },
    );
    if (outcome.kind === "starting")
      return reply
        .status(200)
        .send(ProviderAccountLoginStatusSchema.parse({ providerId: input.providerId, loginId: input.loginId, state: "pending" }));
    if (outcome.kind === "echo")
      return reply.status(200).send(
        ProviderAccountLoginStatusSchema.parse({
          providerId: outcome.record.providerId,
          loginId: outcome.record.loginId,
          state: outcome.record.state,
          ...(outcome.record.message === null ? {} : { message: outcome.record.message }),
        }),
      );
    if (outcome.kind === "contended")
      return reply.status(409).send({
        error: { code: "account_login_operation_in_progress", message: "provider account login operation is already in progress" },
      });
    return reply.status(200).send(
      ProviderAccountLoginStatusSchema.parse({
        providerId: outcome.record.providerId,
        loginId: outcome.record.loginId,
        state: outcome.record.state,
        ...(outcome.record.message === null ? {} : { message: outcome.record.message }),
      }),
    );
  });

  app.post("/v1/provider-account-logins/cancel", async (request, reply) => {
    if (!providerCredentials?.cancelAccountLogin || accountLoginStore === undefined) throw new DurableStoreUnavailableError();
    const input = parse(ProviderAccountLoginStatusSchema.pick({ providerId: true, loginId: true }), request.body);
    const header = request.headers["idempotency-key"];
    const requestId = typeof header === "string" && header.trim() !== "" ? header : randomUUID();
    const operatorId = requestOperator(request as { operator?: OperatorContext }).operatorId;
    const outcome = await cancelAccountLoginFlow(
      { store: accountLoginStore, ownerId: loginOwnerId, staleAfterMs: loginOperationStaleAfterMs },
      { cancelAccountLogin: providerCredentials.cancelAccountLogin },
      { operatorId, loginId: input.loginId, providerId: input.providerId, requestId },
    );
    if (outcome.kind === "echo") return reply.status(200).send({ cancelled: outcome.record.state === "cancelled" });
    if (outcome.kind === "contended")
      return reply.status(409).send({
        error: { code: "account_login_operation_in_progress", message: "provider account login operation is already in progress" },
      });
    return reply.status(200).send({ cancelled: outcome.kind === "cancelled" });
  });

  app.delete("/v1/provider-credentials/:providerId", async (request, reply) => {
    if (!providerCredentials) throw new DurableStoreUnavailableError();
    const providerId = (request.params as { providerId?: unknown }).providerId;
    if (providerId !== "openai" && providerId !== "anthropic") throw new RequestValidationError();
    const header = request.headers["idempotency-key"];
    const requestId = typeof header === "string" && header.trim() !== "" ? header : randomUUID();
    await providerCredentials.revoke({
      operatorId: requestOperator(request as { operator?: OperatorContext }).operatorId,
      requestId,
      providerId,
    });
    return reply.status(200).send({ revoked: true });
  });
}
