import { RouterCatalogReadSchema, RouterConfigInputSchema, RouterConfigValidationSchema } from "@maestro/contracts";
import type { ApiClient } from "../client.js";
import type { MethodContext } from "../context.js";

export type RouterMethods = Pick<ApiClient, "getRouterCatalog" | "validateRouterConfig" | "replaceRouterConfig">;

export function createRouterMethods(ctx: MethodContext): RouterMethods {
  const { request, headers } = ctx;
  return {
    getRouterCatalog() {
      return request("v1/router/catalog", { headers }, RouterCatalogReadSchema);
    },
    validateRouterConfig(input) {
      const parsed = RouterConfigInputSchema.parse(input);
      return request(
        "v1/router/config/validate",
        { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(parsed) },
        RouterConfigValidationSchema,
      );
    },
    replaceRouterConfig(input) {
      const parsed = RouterConfigInputSchema.parse(input);
      return request(
        "v1/router/config",
        { method: "PUT", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(parsed) },
        RouterCatalogReadSchema,
      );
    },
  };
}
