import React, { type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Flashmob } from "./Flashmob.js";
import { FlashmobSession } from "./FlashmobSession.js";

vi.mock("../icons.js", () => ({ Icon: () => null }));
vi.stubGlobal("React", React);

function findButton(node: ReactNode, label: string): ReactElement<{ disabled?: boolean }> | undefined {
  if (node === null || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButton(child, label);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!("type" in node) || !("props" in node)) return undefined;
  const element = node as ReactElement<{ children?: ReactNode; disabled?: boolean }>;
  if (element.type === "button") {
    const text = renderToStaticMarkup(<>{element.props.children}</>);
    if (text.includes(label)) return element;
  }
  return findButton(element.props.children, label);
}

describe("Flashmob deferred surface", () => {
  it("does not present sample sessions or worker progress as live", () => {
    const html = renderToStaticMarkup(<Flashmob onOpenSession={vi.fn()} />);

    expect(html).toContain("deferred");
    expect(html).toContain("out-of-scope");
    expect(html).toContain("Act 2");
    expect(html).not.toContain("fix the pricing page copy");
    expect(html).not.toContain("flashmob worker");
    expect(html).not.toContain("active");
    expect(html).not.toContain("done");
    expect(html).not.toContain("promoted");
  });

  it("does not expose an executable promotion without a backend method", () => {
    const view = FlashmobSession({ onBack: vi.fn() });
    const promote = findButton(view, "promote to goal");

    expect(promote).toBeDefined();
    expect(promote?.props.disabled).toBe(true);
    expect(promote?.props.onClick).toBeUndefined();
    expect(renderToStaticMarkup(<FlashmobSession onBack={vi.fn()} />)).not.toContain("promoted");
  });

  it("keeps the deferred composer disabled", () => {
    const html = renderToStaticMarkup(<FlashmobSession onBack={vi.fn()} />);

    expect(html).toContain("no durable Flashmob session");
    expect(html).toMatch(/textarea[^>]*disabled/);
    expect(html).toMatch(/button[^>]*disabled[^>]*>send/);
  });
});
