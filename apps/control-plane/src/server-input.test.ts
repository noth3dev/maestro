import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parse, RequestValidationError } from "./server-input.js";

describe("parse", () => {
  it("returns data on success", () => {
    expect(parse(z.object({ name: z.string() }), { name: "maestro" })).toEqual({ name: "maestro" });
  });

  it("preserves zod issues with the default message on failure", () => {
    try {
      parse(z.object({ name: z.string() }), { name: 42 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RequestValidationError);
      expect((error as RequestValidationError).message).toBe("Invalid request");
      expect((error as RequestValidationError).issues).toBeDefined();
    }
  });
});

describe("RequestValidationError", () => {
  it("keeps explicit string messages for direct throw sites", () => {
    const error = new RequestValidationError("Idempotency-Key is required");
    expect(error.message).toBe("Idempotency-Key is required");
    expect(error.issues).toBeUndefined();
  });

  it("defaults the message when constructed without arguments", () => {
    const error = new RequestValidationError();
    expect(error.message).toBe("Invalid request");
  });
});
