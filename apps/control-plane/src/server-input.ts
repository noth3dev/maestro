import type { OperatorContext } from "@maestro/persistence";

export class RequestValidationError extends Error {}
export class AuthenticationRequiredError extends Error {}
export class CredentialForbiddenError extends Error {}
export class AuthenticationUnavailableError extends Error {}
export class CriticalActionDeniedError extends Error {
  constructor(reason: string) {
    super(`Critical action denied: ${reason}`);
  }
}
export class CriticalActionRequiresApprovalError extends Error {
  constructor(reason: string) {
    super(`Critical action requires approval: ${reason}`);
  }
}

export function parse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new RequestValidationError();
  return parsed.data;
}

export function parseDepartmentId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9:_-]+$/.test(value)) throw new RequestValidationError();
  return value;
}

export function parseItemId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(value))
    throw new RequestValidationError();
  return value;
}

export function parseCertificationKind(value: unknown): "security" | "safety_compliance" {
  if (value !== "security" && value !== "safety_compliance") throw new RequestValidationError();
  return value;
}

export function parsePositiveInteger(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 1) throw new RequestValidationError();
  return parsed;
}

export function bearerSecret(authorization: string | string[] | undefined): string | undefined {
  if (typeof authorization !== "string") return undefined;
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  return match?.[1];
}

export function requestOperator(request: { operator?: OperatorContext }): OperatorContext {
  if (!request.operator) throw new AuthenticationRequiredError();
  return request.operator;
}

export function isProjectAccessProvisioningRoute(url: string): boolean {
  return url === "/v1/admin/project-access" || url.startsWith("/v1/admin/project-access?");
}

export function requestProjectId(request: { query?: unknown; body?: unknown }): string | undefined {
  const fromQuery = (request.query as { projectId?: unknown } | undefined)?.projectId;
  const fromBody = (request.body as { projectId?: unknown } | undefined)?.projectId;
  if (typeof fromQuery === "string" && typeof fromBody === "string" && fromQuery !== fromBody) throw new RequestValidationError();
  if (typeof fromQuery === "string") return fromQuery;
  if (typeof fromBody === "string") return fromBody;
  return undefined;
}

export function isMalformedJsonError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "FST_ERR_CTP_INVALID_JSON_BODY";
}
