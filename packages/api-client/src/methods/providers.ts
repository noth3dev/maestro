import {
  ProviderCredentialLoginInputSchema,
  ProviderCredentialBindingSchema,
  ProviderAccountLoginStartInputSchema,
  ProviderAccountLoginStartResultSchema,
  ProviderAccountLoginStatusSchema,
  SettingsProviderSchema,
} from "@maestro/contracts";
import { cryptoRandomUuid } from "../transport.js";
import type { ApiClient } from "../client.js";
import type { MethodContext } from "../context.js";

export function createProvidersMethods(
  ctx: MethodContext,
): Pick<
  ApiClient,
  | "listProviderConnections"
  | "loginProvider"
  | "logoutProvider"
  | "startAccountLogin"
  | "accountLoginStatus"
  | "cancelAccountLogin"
  | "logoutAccount"
> {
  const { request, headers } = ctx;
  return {
    listProviderConnections() {
      return request(
        "v1/provider-credentials",
        { headers },
        {
          parse(body: unknown) {
            if (!Array.isArray(body)) throw new Error("Control plane returned malformed provider connections");
            return body.map((item) => SettingsProviderSchema.parse(item));
          },
        },
      );
    },
    loginProvider(input) {
      const parsed = ProviderCredentialLoginInputSchema.parse(input);
      return request(
        "v1/provider-credentials",
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": cryptoRandomUuid() },
          body: JSON.stringify(parsed),
        },
        ProviderCredentialBindingSchema,
      );
    },
    logoutProvider(providerId) {
      if (providerId !== "openai" && providerId !== "anthropic") throw new Error("Invalid provider");
      return request(
        `v1/provider-credentials/${encodeURIComponent(providerId)}`,
        {
          method: "DELETE",
          headers: { ...headers, "idempotency-key": cryptoRandomUuid() },
        },
        { parse: () => undefined },
      );
    },
    startAccountLogin(providerId) {
      const input = ProviderAccountLoginStartInputSchema.parse({ providerId });
      return request(
        "v1/provider-account-logins/start",
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": cryptoRandomUuid() },
          body: JSON.stringify(input),
        },
        ProviderAccountLoginStartResultSchema,
      );
    },
    accountLoginStatus(providerId, loginId) {
      if (typeof loginId !== "string" || loginId.trim() === "") throw new Error("Invalid login session");
      return request(
        "v1/provider-account-logins/status",
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": cryptoRandomUuid() },
          body: JSON.stringify({ providerId, loginId }),
        },
        ProviderAccountLoginStatusSchema,
      );
    },
    cancelAccountLogin(providerId, loginId) {
      if (typeof loginId !== "string" || loginId.trim() === "") throw new Error("Invalid login session");
      return request(
        "v1/provider-account-logins/cancel",
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": cryptoRandomUuid() },
          body: JSON.stringify({ providerId, loginId }),
        },
        { parse: () => undefined },
      );
    },
    logoutAccount(providerId) {
      return request(
        "v1/provider-account-logins/logout",
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": cryptoRandomUuid() },
          body: JSON.stringify({ providerId }),
        },
        {
          parse(value) {
            if (!value || typeof value !== "object" || (value as { revoked?: unknown }).revoked !== true)
              throw new Error("Control Plane returned malformed account logout");
            return undefined;
          },
        },
      );
    },
  };
}
