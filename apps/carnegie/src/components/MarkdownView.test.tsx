import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownView } from "./MarkdownView.js";

describe("MarkdownView", () => {
  it("renders common Markdown blocks and inline marks", () => {
    const html = renderToStaticMarkup(
      <MarkdownView source={"# Plan\n\nShip **fast** with `tests`.\n\n- [x] one\n- two\n\n1. first\n\n```ts\nconst a = 1;\n```\n\n> note"} />,
    );
    expect(html).toContain("<h1>Plan</h1>");
    expect(html).toContain("<strong>fast</strong>");
    expect(html).toContain("<code>tests</code>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<ol><li>first</li></ol>");
    expect(html).toContain('data-language="ts"');
    expect(html).toContain("const a = 1;");
    expect(html).toContain("<blockquote><p>note</p></blockquote>");
  });

  it("never turns file content into HTML or unsafe links", () => {
    const html = renderToStaticMarkup(<MarkdownView source={'<img src=x onerror="alert(1)">\n\n[x](javascript:alert(1)) [ok](https://example.com)'} />);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="https://example.com"');
  });
});
