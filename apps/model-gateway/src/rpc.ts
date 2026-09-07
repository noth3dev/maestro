import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import type { GatewayAccountLoginStartRequest, GatewayAccountLoginStatusRequest, GatewayAdmissionRequest, GatewayBinding, GatewayCredentialBindRequest, GatewayCredentialRevokeRequest, GatewayTurnRequest, ModelGatewayPort, ModelMessage, ModelStreamEvent, ModelToolDefinition, TurnLimits } from "@maestro/agent-runtime";

const IdentitySchema = z.object({ provider: z.string().min(1).max(64), id: z.string().min(1).max(256) }).strict();
const BindingSchema = z.object({
  bindingId: z.string().min(1).max(128), gatewayInstanceId: z.string().min(1).max(128),
  provider: IdentitySchema,
  account: z.object({ providerId: z.string().min(1).max(64), accountRef: z.string().min(1).max(256), authMode: z.enum(["api-key", "managed-subscription"]) }).strict(),
  dataPolicyHash: z.string().min(1).max(256),
}).strict();
const LimitsSchema = z.object({
  maxModelTurns: z.number().int().nonnegative().max(100), maxToolCalls: z.number().int().nonnegative().max(1_000), maxChildCalls: z.number().int().nonnegative().max(100),
  maxOutputTokens: z.number().int().positive().max(1_000_000), maxInputBytes: z.number().int().positive().max(10_000_000), maxResultBytes: z.number().int().positive().max(10_000_000),
  providerTimeoutMs: z.number().int().positive().max(600_000), wallTimeMs: z.number().int().positive().max(3_600_000),
}).strict();
const AdmitSchema = z.object({
  requestId: z.string().min(1).max(128), operatorId: z.string().min(1).max(128), providerId: z.string().min(1).max(64), model: IdentitySchema, accountRef: z.string().min(1).max(256), dataPolicyHash: z.string().min(1).max(256),
}).strict();
const CredentialBindSchema = z.object({
  requestId: z.string().min(1).max(128), operatorId: z.string().min(1).max(128), providerId: z.enum(["openai", "anthropic"]), authMode: z.literal("api-key"), secret: z.string().min(1).max(512),
}).strict();
const CredentialRevokeSchema = z.object({
  requestId: z.string().min(1).max(128), operatorId: z.string().min(1).max(128), providerId: z.enum(["openai", "anthropic"]),
}).strict();
const AccountLoginStartSchema = z.object({
  requestId: z.string().min(1).max(128), operatorId: z.string().min(1).max(128), providerId: z.literal("openai-codex"),
}).strict();
const AccountLoginStatusSchema = z.object({
  requestId: z.string().min(1).max(128), operatorId: z.string().min(1).max(128), providerId: z.literal("openai-codex"), loginId: z.string().min(1).max(256),
}).strict();
const AccountLogoutSchema = z.object({
  requestId: z.string().min(1).max(128), operatorId: z.string().min(1).max(128), providerId: z.literal("openai-codex"),
}).strict();
const TurnSchema = z.object({
  binding: BindingSchema, requestId: z.string().min(1).max(128), sessionId: z.string().min(1).max(128), turnId: z.string().min(1).max(128),
  messages: z.array(z.unknown()).max(128), tools: z.array(z.unknown()).max(128), limits: LimitsSchema,
}).strict();
const CancelSchema = z.object({ requestId: z.string().min(1).max(128) }).strict();
const RecoverSchema = z.object({ binding: BindingSchema }).strict();

function authorized(request: { headers: Record<string, unknown> }, token: string): boolean {
  const actual = request.headers.authorization;
  if (typeof actual !== "string" || !actual.startsWith("Bearer ")) return false;
  const provided = Buffer.from(actual.slice(7));
  const expected = Buffer.from(token);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function errorCode(error: unknown): { status: number; code: string; message: string } {
  const message = error instanceof Error ? error.message : "model gateway request failed";
  if (message.includes("credential binding")) return { status: 403, code: "provider_auth_required", message: "provider credential binding is unavailable" };
  if (message.includes("unknown provider") || message.includes("unknown model")) return { status: 400, code: "model_not_allowed", message: "provider or model is not allowed" };
  if (message.includes("identity") || message.includes("binding")) return { status: 409, code: "provider_binding_mismatch", message: "provider binding could not be verified" };
  if (message.includes("closed") || message.includes("transport")) return { status: 503, code: "provider_unavailable", message: "model gateway is unavailable" };
  return { status: 400, code: "invalid_gateway_request", message: "model gateway request is invalid" };
}

export function buildModelGatewayServer(options: { gateway: ModelGatewayPort; token: string; operatorId: string; bodyLimit?: number }): FastifyInstance {
  const app = Fastify({ bodyLimit: options.bodyLimit ?? 1_048_576 });
  const guard = async (request: { headers: Record<string, unknown> }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }): Promise<boolean> => {
    if (authorized(request, options.token)) return true;
    reply.code(401).send({ error: { code: "gateway_auth_required", message: "model gateway authentication required" } });
    return false;
  };

  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/v1/models", async (request, reply) => {
    if (!(await guard(request, reply))) return;
    try {
      const models = await options.gateway.listModels({ operatorId: options.operatorId });
      return models.map((model) => ({ ...model, capabilities: [...model.capabilities] }));
    } catch (error) { const mapped = errorCode(error); return reply.code(mapped.status).send({ error: { code: mapped.code, message: mapped.message } }); }
  });
  app.post("/v1/credentials/bind", async (request, reply) => {
    if (!(await guard(request, reply))) return;
    const parsed = CredentialBindSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_gateway_request", message: "invalid credential binding request" } });
    if (parsed.data.operatorId !== options.operatorId) return reply.code(403).send({ error: { code: "gateway_auth_required", message: "gateway operator context is invalid" } });
    try {
      if (!options.gateway.bindCredential) throw new Error("credential binding is unavailable");
      return await options.gateway.bindCredential(parsed.data as GatewayCredentialBindRequest);
    } catch (error) { const mapped = errorCode(error); return reply.code(mapped.status).send({ error: { code: mapped.code, message: mapped.message } }); }
  });
  app.post("/v1/account-logins/start", async (request, reply) => {
    if (!(await guard(request, reply))) return;
    const parsed = AccountLoginStartSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_gateway_request", message: "invalid account login request" } });
    if (parsed.data.operatorId !== options.operatorId) return reply.code(403).send({ error: { code: "gateway_auth_required", message: "gateway operator context is invalid" } });
    try {
      if (!options.gateway.startAccountLogin) throw new Error("account login is unavailable");
      return await options.gateway.startAccountLogin(parsed.data as GatewayAccountLoginStartRequest);
    } catch (error) { const mapped = errorCode(error); return reply.code(mapped.status).send({ error: { code: mapped.code, message: mapped.message } }); }
  });
  app.post("/v1/account-logins/status", async (request, reply) => {
    if (!(await guard(request, reply))) return;
    const parsed = AccountLoginStatusSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_gateway_request", message: "invalid account login status request" } });
    if (parsed.data.operatorId !== options.operatorId) return reply.code(403).send({ error: { code: "gateway_auth_required", message: "gateway operator context is invalid" } });
    try {
      if (!options.gateway.accountLoginStatus) throw new Error("account login is unavailable");
      return await options.gateway.accountLoginStatus(parsed.data as GatewayAccountLoginStatusRequest);
    } catch (error) { const mapped = errorCode(error); return reply.code(mapped.status).send({ error: { code: mapped.code, message: mapped.message } }); }
  });
  app.post("/v1/account-logins/logout", async (request, reply) => {
    if (!(await guard(request, reply))) return;
    const parsed = AccountLogoutSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_gateway_request", message: "invalid account logout request" } });
    if (parsed.data.operatorId !== options.operatorId) return reply.code(403).send({ error: { code: "gateway_auth_required", message: "gateway operator context is invalid" } });
    try {
      if (!options.gateway.logoutAccount) throw new Error("account logout is unavailable");
      await options.gateway.logoutAccount(parsed.data);
      return { revoked: true };
    } catch (error) { const mapped = errorCode(error); return reply.code(mapped.status).send({ error: { code: mapped.code, message: mapped.message } }); }
  });

  app.post("/v1/account-logins/cancel", async (request, reply) => {
    if (!(await guard(request, reply))) return;
    const parsed = AccountLoginStatusSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_gateway_request", message: "invalid account login cancellation request" } });
    if (parsed.data.operatorId !== options.operatorId) return reply.code(403).send({ error: { code: "gateway_auth_required", message: "gateway operator context is invalid" } });
    try {
      if (!options.gateway.cancelAccountLogin) throw new Error("account login is unavailable");
      await options.gateway.cancelAccountLogin(parsed.data as GatewayAccountLoginStatusRequest);
      return { cancelled: true };
    } catch (error) { const mapped = errorCode(error); return reply.code(mapped.status).send({ error: { code: mapped.code, message: mapped.message } }); }
  });

  app.post("/v1/credentials/revoke", async (request, reply) => {
    if (!(await guard(request, reply))) return;
    const parsed = CredentialRevokeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_gateway_request", message: "invalid credential revocation request" } });
    if (parsed.data.operatorId !== options.operatorId) return reply.code(403).send({ error: { code: "gateway_auth_required", message: "gateway operator context is invalid" } });
    try {
      if (!options.gateway.revokeCredential) throw new Error("credential binding is unavailable");
      await options.gateway.revokeCredential(parsed.data as GatewayCredentialRevokeRequest);
      return { revoked: true };
    } catch (error) { const mapped = errorCode(error); return reply.code(mapped.status).send({ error: { code: mapped.code, message: mapped.message } }); }
  });

  app.post("/v1/admit", async (request, reply) => {
    if (!(await guard(request, reply))) return;
    const parsed = AdmitSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_gateway_request", message: "invalid model admission request" } });
    if (parsed.data.operatorId !== options.operatorId) return reply.code(403).send({ error: { code: "gateway_auth_required", message: "gateway operator context is invalid" } });
    try { return await options.gateway.admit(parsed.data as GatewayAdmissionRequest); }
    catch (error) { const mapped = errorCode(error); return reply.code(mapped.status).send({ error: { code: mapped.code, message: mapped.message } }); }
  });
  app.post("/v1/turn", async (request, reply) => {
    if (!(await guard(request, reply))) return;
    const parsed = TurnSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_gateway_request", message: "invalid model turn request" } });
    const eventLimit = 256;
    let eventCount = 0;
    const body = parsed.data;
    const turn: GatewayTurnRequest = {
      binding: body.binding as GatewayBinding, requestId: body.requestId, sessionId: body.sessionId, turnId: body.turnId,
      messages: body.messages as ModelMessage[], tools: body.tools as ModelToolDefinition[], limits: body.limits as TurnLimits, signal: new AbortController().signal,
      emit: (_event: ModelStreamEvent) => { eventCount += 1; if (eventCount > eventLimit) throw new Error("gateway event limit exceeded"); },
    };
    try { return await options.gateway.turn(turn); }
    catch (error) { const mapped = errorCode(error); return reply.code(mapped.status).send({ error: { code: mapped.code, message: mapped.message } }); }
  });
  app.post("/v1/turn/stream", async (request, reply) => {
    if (!(await guard(request, reply))) return;
    const parsed = TurnSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_gateway_request", message: "invalid model turn request" } });
    const body = parsed.data;
    const eventLimit = 256;
    let eventCount = 0;
    reply.hijack();
    reply.raw.setHeader("content-type", "text/event-stream; charset=utf-8");
    reply.raw.setHeader("cache-control", "no-cache");
    reply.raw.setHeader("connection", "keep-alive");
    const writeEvent = (event: ModelStreamEvent) => {
      eventCount += 1;
      if (eventCount > eventLimit) throw new Error("gateway event limit exceeded");
      reply.raw.write(`event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    const turn: GatewayTurnRequest = {
      binding: body.binding as GatewayBinding, requestId: body.requestId, sessionId: body.sessionId, turnId: body.turnId,
      messages: body.messages as ModelMessage[], tools: body.tools as ModelToolDefinition[], limits: body.limits as TurnLimits, signal: new AbortController().signal,
      emit: writeEvent,
    };
    try {
      const result = await options.gateway.turn(turn);
      reply.raw.write(`event: result\ndata: ${JSON.stringify(result)}\n\n`);
      reply.raw.end();
      return reply;
    } catch (error) {
      const mapped = errorCode(error);
      if (!reply.raw.writableEnded) { reply.raw.write(`event: error\ndata: ${JSON.stringify({ code: mapped.code, message: mapped.message })}\n\n`); reply.raw.end(); }
      return reply;
    }
  });
  app.post("/v1/cancel", async (request, reply) => {
    if (!(await guard(request, reply))) return;
    const parsed = CancelSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_gateway_request", message: "invalid cancellation request" } });
    try { return await options.gateway.cancel(parsed.data.requestId); }
    catch (error) { const mapped = errorCode(error); return reply.code(mapped.status).send({ error: { code: mapped.code, message: mapped.message } }); }
  });
  app.post("/v1/recover", async (request, reply) => {
    if (!(await guard(request, reply))) return;
    const parsed = RecoverSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_gateway_request", message: "invalid recovery request" } });
    try { return { state: await options.gateway.recover(parsed.data.binding as GatewayBinding) }; }
    catch (error) { const mapped = errorCode(error); return reply.code(mapped.status).send({ error: { code: mapped.code, message: mapped.message } }); }
  });
  return app;
}
