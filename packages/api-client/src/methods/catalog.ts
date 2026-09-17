import {
  ModelCatalogEntrySchema,
  SettingsReadSchema,
  SettingsPreferencesUpdateSchema,
  SettingsModelPoolUpdateSchema,
  SettingsAuthorityDefaultsUpdateSchema,
} from "@maestro/contracts";
import type { ApiClient } from "../client.js";
import type { MethodContext } from "../context.js";

export function createCatalogMethods(
  ctx: MethodContext,
): Pick<
  ApiClient,
  "listModels" | "getSettings" | "updateSettingsPreferences" | "updateSettingsModelPool" | "updateSettingsAuthorityDefaults"
> {
  const { request, headers } = ctx;
  return {
    listModels() {
      return request(
        "v1/models",
        { headers },
        {
          parse(body: unknown) {
            if (!Array.isArray(body)) throw new Error("Control plane returned malformed model catalog");
            return body.map((item) => ModelCatalogEntrySchema.parse(item));
          },
        },
      );
    },
    getSettings() {
      return request("v1/settings", { headers }, SettingsReadSchema);
    },
    updateSettingsPreferences(patch) {
      const parsed = SettingsPreferencesUpdateSchema.parse(patch);
      return request(
        "v1/settings/preferences",
        { method: "PATCH", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(parsed) },
        SettingsReadSchema,
      );
    },
    updateSettingsModelPool(patch) {
      const parsed = SettingsModelPoolUpdateSchema.parse(patch);
      return request(
        "v1/settings/model-pool",
        { method: "PATCH", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(parsed) },
        SettingsReadSchema,
      );
    },
    updateSettingsAuthorityDefaults(patch) {
      const parsed = SettingsAuthorityDefaultsUpdateSchema.parse(patch);
      return request(
        "v1/settings/authority-defaults",
        { method: "PATCH", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(parsed) },
        SettingsReadSchema,
      );
    },
  };
}
