import React, { type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConfirmActionDialog } from "./ConfirmActionDialog.js";

type DialogProps = React.ComponentProps<typeof ConfirmActionDialog>;
type DialogElement = ReactElement<DialogProps & { children?: ReactNode; onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void }>;

function openDialog(overrides: Partial<DialogProps> = {}): DialogElement {
  return ConfirmActionDialog({
    open: true,
    title: "Stop this Goal?",
    effectSummary: "Stop will halt all active workers and prevent new work.",
    confirmLabel: "Stop Goal",
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides,
  }) as DialogElement;
}

describe("ConfirmActionDialog", () => {
  it("does not render when closed", () => {
    expect(ConfirmActionDialog({
      open: false,
      title: "unused",
      effectSummary: "unused",
      confirmLabel: "confirm",
      onCancel: vi.fn(),
      onConfirm: vi.fn(),
    })).toBeNull();
  });

  it("renders an explicit effect summary and labelled dialog", () => {
    const html = renderToStaticMarkup(openDialog({ danger: true }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Stop will halt all active workers");
    expect(html).toContain("Stop Goal");
    expect(html).toContain('autofocus=""');
  });

  it("maps Escape to cancel and only confirms Enter on the dialog surface", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const backdrop = openDialog({ onCancel, onConfirm });
    const dialog = backdrop.props.children as DialogElement;
    const keyDown = dialog.props.onKeyDown;
    expect(keyDown).toBeDefined();

    const preventDefault = vi.fn();
    keyDown?.({ key: "Escape", target: dialog, currentTarget: dialog, preventDefault } as unknown as React.KeyboardEvent<HTMLDivElement>);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);

    keyDown?.({ key: "Enter", target: { nodeName: "BUTTON" }, currentTarget: dialog, preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLDivElement>);
    expect(onConfirm).not.toHaveBeenCalled();

    keyDown?.({ key: "Enter", target: dialog, currentTarget: dialog, preventDefault } as unknown as React.KeyboardEvent<HTMLDivElement>);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});


it("wires cancel and confirm buttons and gives each dialog unique labelled IDs", () => {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  const first = openDialog({ onCancel, onConfirm });
  const second = openDialog();
  const firstMarkup = renderToStaticMarkup(first);
  const secondMarkup = renderToStaticMarkup(second);
  const firstTitleId = firstMarkup.match(/aria-labelledby="([^"]+)"/)?.[1];
  const secondTitleId = secondMarkup.match(/aria-labelledby="([^"]+)"/)?.[1];
  expect(firstTitleId).toBeDefined();
  expect(secondTitleId).toBeDefined();
  expect(firstTitleId).not.toBe(secondTitleId);

  const dialog = first.props.children as DialogElement;
  const buttons = (dialog.props.children as ReactNode[]).find((child) => React.isValidElement(child) && child.type === "div") as ReactElement<{ children?: ReactNode }>;
  const [cancel, confirm] = buttons.props.children as ReactElement<{ onClick?: () => void }>[];
  cancel?.props.onClick?.();
  confirm?.props.onClick?.();
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onConfirm).toHaveBeenCalledTimes(1);
});
