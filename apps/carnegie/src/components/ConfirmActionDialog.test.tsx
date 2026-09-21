import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConfirmActionDialog, handleConfirmActionKeyDown } from "./ConfirmActionDialog.js";

const props = {
  title: "Stop this Goal?",
  effectSummary: "Stop will halt all active workers and prevent new work.",
  confirmLabel: "Stop Goal",
  onCancel: vi.fn(),
  onConfirm: vi.fn(),
};

describe("ConfirmActionDialog", () => {
  it("does not render when closed", () => {
    expect(renderToStaticMarkup(<ConfirmActionDialog {...props} open={false} />)).toBe("");
  });

  it("renders an explicit effect summary and labelled dialog", () => {
    const html = renderToStaticMarkup(<ConfirmActionDialog {...props} open danger />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Stop will halt all active workers");
    expect(html).toContain("Stop Goal");
    expect(html).not.toContain("autofocus");
  });

  it("maps Escape and surface Enter to the intended callbacks", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const currentTarget = { querySelectorAll: () => [], contains: () => true };
    const event = (key: string, target: unknown = currentTarget) => ({
      key,
      target,
      currentTarget,
      preventDefault: vi.fn(),
      shiftKey: false,
    }) as unknown as React.KeyboardEvent<HTMLDivElement>;

    handleConfirmActionKeyDown(event("Escape"), onCancel, onConfirm);
    handleConfirmActionKeyDown(event("Enter", currentTarget), onCancel, onConfirm);
    handleConfirmActionKeyDown(event("Enter", { nodeName: "BUTTON" }), onCancel, onConfirm);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("keeps labelled IDs unique when dialogs share a render tree", () => {
    const html = renderToStaticMarkup(
      <>
        <ConfirmActionDialog {...props} open />
        <ConfirmActionDialog {...props} open />
      </>,
    );
    const ids = [...html.matchAll(/aria-labelledby="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
});
