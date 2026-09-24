import { RouterConfigInputSchema, type RouterConfigInput, type RouterConfigValidation } from "@maestro/contracts";

export function routerConfigDocument(value: unknown): RouterConfigInput {
  return RouterConfigInputSchema.parse(value);
}

export function createRouterConfigImportController() {
  let validating = false;

  return {
    get validating() {
      return validating;
    },
    async validate(
      file: Pick<Blob, "text">,
      validateConfig: (input: RouterConfigInput) => Promise<RouterConfigValidation>,
    ): Promise<{ input: RouterConfigInput; result: RouterConfigValidation } | undefined> {
      if (validating) return undefined;
      validating = true;
      try {
        const input = routerConfigDocument(JSON.parse(await file.text()));
        const result = await validateConfig(input);
        return { input, result };
      } finally {
        validating = false;
      }
    },
  };
}
