import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ApiErrorNotice } from "./ApiErrorNotice.js";

vi.mock("../icons.js", () => ({ Icon: () => null }));

describe("ApiErrorNotice", () => {
  it("renders sanitized stable API detail and only shows retry for retryable errors", () => {
    const authority = renderToStaticMarkup(
      <ApiErrorNotice error={{ name: "ApiError", status: 403, code: "authority_denied", message: "Not authorized" }} onRetry={() => undefined} />,
    );
    expect(authority).toContain("Not authorized");
    expect(authority).not.toContain("retry");

    const retryable = renderToStaticMarkup(
      <ApiErrorNotice error={{ name: "ApiError", status: 503, code: "provider_unavailable", message: "token=provider-secret" }} onRetry={() => undefined} />,
    );
    expect(retryable).toContain("Model provider is unavailable");
    expect(retryable).toContain("token=[redacted]");
    expect(retryable).toContain("retry");
    expect(retryable).not.toContain("provider-secret");
  });
});
