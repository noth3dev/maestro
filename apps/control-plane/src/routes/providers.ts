import type { FastifyInstance } from "fastify";
import type { RouteDeps } from "../server.js";
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
import { ModelGatewayClientError } from "../model-gateway-client.js";
import type { OperatorContext, AccountLoginStore, AccountLoginRecord } from "@maestro/persistence";

function toAccountLoginStartResult(record: AccountLoginRecord): import("@maestro/agent-runtime").GatewayAccountLoginStartResult {
  if (record.providerLoginId === null || record.authUrl === null) throw new Error(record.message ?? "Provider account login is not ready");
  return { providerId: record.providerId, loginId: record.loginId, authUrl: record.authUrl };
}

function isLostGatewayLogin(error: unknown): boolean {
  return error instanceof ModelGatewayClientError && error.code === "account_login_session_unknown";
}

async function waitForAccountLoginStart(store: AccountLoginStore, operatorId: string, requestId: string): Promise<AccountLoginRecord> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const record = await store.getByRequest(operatorId, requestId);
    if (record !== undefined && record.state !== "starting") return record;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("account login start is still in progress");
}

export function registerProviderRoutes(app: FastifyInstance, deps: RouteDeps): void {
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
    const reservation = await accountLoginStore.reserveStart(operatorId, requestId, input.providerId, loginOwnerId);
    let record = reservation.record;
    if (reservation.created) {
      try {
        const providerResult = await providerCredentials.startAccountLogin({ operatorId, requestId, providerId: input.providerId });
        record = await accountLoginStore.completeStart(record.loginId, providerResult.loginId, providerResult.authUrl);
      } catch (error) {
        await accountLoginStore.failStart(record.loginId, "Provider account login failed").catch(() => undefined);
        throw error;
      }
    } else if (record.state === "starting") {
      record = await waitForAccountLoginStart(accountLoginStore, operatorId, requestId);
    }
    return reply.status(200).send(ProviderAccountLoginStartResultSchema.parse(toAccountLoginStartResult(record)));
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
    const record = await accountLoginStore.get(input.loginId, operatorId);
    if (record === undefined || record.providerId !== input.providerId) throw new Error("account login session is unknown");
    if (record.state === "starting")
      return reply
        .status(200)
        .send(ProviderAccountLoginStatusSchema.parse({ providerId: record.providerId, loginId: record.loginId, state: "pending" }));
    if (record.state !== "pending" || record.providerLoginId === null)
      return reply.status(200).send(
        ProviderAccountLoginStatusSchema.parse({
          providerId: record.providerId,
          loginId: record.loginId,
          state: record.state,
          ...(record.message === null ? {} : { message: record.message }),
        }),
      );
    const operationToken = await accountLoginStore.claimOperation(
      record.loginId,
      operatorId,
      "status",
      loginOwnerId,
      loginOperationStaleAfterMs,
    );
    if (operationToken === undefined) {
      const current = await accountLoginStore.get(record.loginId, operatorId);
      if (current === undefined) throw new Error("account login session is unknown");
      if (current.state !== "pending" || current.providerLoginId === null)
        return reply.status(200).send(
          ProviderAccountLoginStatusSchema.parse({
            providerId: current.providerId,
            loginId: current.loginId,
            state: current.state,
            ...(current.message === null ? {} : { message: current.message }),
          }),
        );
      return reply.status(409).send({
        error: { code: "account_login_operation_in_progress", message: "provider account login operation is already in progress" },
      });
    }
    try {
      let result: import("@maestro/agent-runtime").GatewayAccountLoginStatusResult;
      try {
        result = await providerCredentials.accountLoginStatus({
          operatorId,
          requestId,
          providerId: input.providerId,
          loginId: record.providerLoginId,
        });
      } catch (error) {
        if (!isLostGatewayLogin(error)) throw error;
        const unknown = await accountLoginStore.updateState(
          record.loginId,
          operatorId,
          "unknown",
          "Gateway login session was lost during restart",
          loginOwnerId,
          operationToken,
        );
        return reply.status(200).send(
          ProviderAccountLoginStatusSchema.parse({
            providerId: unknown.providerId,
            loginId: unknown.loginId,
            state: unknown.state,
            message: unknown.message,
          }),
        );
      }
      const updated = await accountLoginStore.updateState(
        record.loginId,
        operatorId,
        result.state,
        result.message,
        loginOwnerId,
        operationToken,
      );
      return reply.status(200).send(
        ProviderAccountLoginStatusSchema.parse({
          providerId: updated.providerId,
          loginId: updated.loginId,
          state: updated.state,
          ...(updated.message === null ? {} : { message: updated.message }),
        }),
      );
    } finally {
      await accountLoginStore.releaseOperation(record.loginId, operatorId, loginOwnerId, operationToken).catch(() => undefined);
    }
  });

  app.post("/v1/provider-account-logins/cancel", async (request, reply) => {
    if (!providerCredentials?.cancelAccountLogin || accountLoginStore === undefined) throw new DurableStoreUnavailableError();
    const input = parse(ProviderAccountLoginStatusSchema.pick({ providerId: true, loginId: true }), request.body);
    const header = request.headers["idempotency-key"];
    const requestId = typeof header === "string" && header.trim() !== "" ? header : randomUUID();
    const operatorId = requestOperator(request as { operator?: OperatorContext }).operatorId;
    const record = await accountLoginStore.get(input.loginId, operatorId);
    if (record === undefined || record.providerId !== input.providerId) throw new Error("account login session is unknown");
    if (record.state !== "pending" || record.providerLoginId === null)
      return reply.status(200).send({ cancelled: record.state === "cancelled" });
    const operationToken = await accountLoginStore.claimOperation(
      record.loginId,
      operatorId,
      "cancel",
      loginOwnerId,
      loginOperationStaleAfterMs,
    );
    if (operationToken === undefined) {
      const current = await accountLoginStore.get(record.loginId, operatorId);
      if (current === undefined) throw new Error("account login session is unknown");
      if (current.state !== "pending" || current.providerLoginId === null)
        return reply.status(200).send({ cancelled: current.state === "cancelled" });
      return reply.status(409).send({
        error: { code: "account_login_operation_in_progress", message: "provider account login operation is already in progress" },
      });
    }
    try {
      try {
        await providerCredentials.cancelAccountLogin({
          operatorId,
          requestId,
          providerId: input.providerId,
          loginId: record.providerLoginId,
        });
        await accountLoginStore.updateState(record.loginId, operatorId, "cancelled", undefined, loginOwnerId, operationToken);
      } catch (error) {
        if (!isLostGatewayLogin(error)) throw error;
        await accountLoginStore.updateState(
          record.loginId,
          operatorId,
          "unknown",
          "Gateway login session was lost during restart",
          loginOwnerId,
          operationToken,
        );
        return reply.status(200).send({ cancelled: false });
      }
      return reply.status(200).send({ cancelled: true });
    } finally {
      await accountLoginStore.releaseOperation(record.loginId, operatorId, loginOwnerId, operationToken).catch(() => undefined);
    }
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
