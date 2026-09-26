import { sanitizeBootstrapMessage } from "./bootstrap-status.js";

export function createConfigErrorHandler(getSetupError: () => string | undefined): () => string | undefined {
  return () => {
    const setupError = getSetupError();
    return setupError === undefined ? undefined : sanitizeBootstrapMessage(setupError);
  };
}

export async function withSanitizedConfigError<Result>(operation: () => Result | Promise<Result>, fallback: string): Promise<Result> {
  try {
    return await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : fallback;
    throw new Error(sanitizeBootstrapMessage(message));
  }
}
