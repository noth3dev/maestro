import React, { useEffect, useId, useRef } from "react";
import type { KeyboardEvent, ReactElement } from "react";

export interface ConfirmActionDialogProps {
  open: boolean;
  title: string;
  effectSummary: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function handleConfirmActionKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  onCancel: () => void,
  onConfirm: () => void,
): void {
  if (event.key === "Escape") {
    event.preventDefault();
    onCancel();
    return;
  }
  if (event.key === "Enter" && event.target === event.currentTarget) {
    event.preventDefault();
    onConfirm();
    return;
  }
  if (event.key !== "Tab") return;
  const currentTarget = event.currentTarget;
  const focusable = Array.from(currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  if (focusable.length === 0) return;
  const active = document.activeElement;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (first === undefined || last === undefined) return;
  if (event.shiftKey && (active === first || active === currentTarget)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || active === currentTarget)) {
    event.preventDefault();
    first.focus();
  }
}

/** Explicit, keyboard-safe confirmation for actions with an operator-visible effect. */
export function ConfirmActionDialog({
  open,
  title,
  effectSummary,
  confirmLabel,
  danger = false,
  onCancel,
  onConfirm,
}: ConfirmActionDialogProps): ReactElement | null {
  const instanceId = useId();
  const titleId = `confirm-action-title-${instanceId}`;
  const effectId = `confirm-action-effect-${instanceId}`;
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
      return;
    }
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => {
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="confirm-action-backdrop" role="presentation">
      <div
        ref={dialogRef}
        className={`confirm-action-dialog${danger ? " confirm-action-dialog-danger" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={effectId}
        tabIndex={-1}
        onKeyDown={(event) => handleConfirmActionKeyDown(event, onCancel, onConfirm)}
      >
        <h2 id={titleId}>{title}</h2>
        <p id={effectId}>{effectSummary}</p>
        <div className="confirm-action-buttons">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className={`btn${danger ? " btn-danger" : " btn-primary"}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
