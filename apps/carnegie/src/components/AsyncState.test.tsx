import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AsyncState } from "./AsyncState.js";

vi.mock("../icons.js", () => ({ Icon: () => null }));

describe("AsyncState", () => {
  it("announces loading state accessibly", () => {
    const html = renderToStaticMarkup(<AsyncState status="loading" />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("loading…");
  });

  it("renders the supplied empty state without inventing records", () => {
    const html = renderToStaticMarkup(<AsyncState status="empty" emptyMessage="No workers exist for this Goal yet." />);
    expect(html).toContain("No workers exist for this Goal yet.");
    expect(html).not.toContain("Worker 1");
  });

  it("renders a retryable API error through the shared error notice", () => {
    const html = renderToStaticMarkup(<AsyncState status="error" error={new Error("Control plane request failed")} onRetry={() => undefined} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Connection problem");
    expect(html).toContain("retry");
  });
});


it("renders ready children without an async wrapper", () => {
  const html = renderToStaticMarkup(<AsyncState status="ready"><span>durable content</span></AsyncState>);
  expect(html).toBe("<span>durable content</span>");
});

it("does not offer retry for an authority denial", () => {
  const html = renderToStaticMarkup(<AsyncState status="error" error={{ name: "ApiError", status: 403, code: "authority_denied", message: "Not authorized" }} onRetry={() => undefined} />);
  expect(html).toContain("Not authorized");
  expect(html).not.toContain(">retry<");
});
