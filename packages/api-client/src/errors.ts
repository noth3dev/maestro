import type { StableApiError } from "@maestro/contracts";

export class ApiError extends Error {
  readonly name = "ApiError";

  constructor(
    readonly status: number,
    readonly code: StableApiError["error"]["code"],
    message: string,
    readonly detail?: string,
  ) {
    super(message);
  }
}
