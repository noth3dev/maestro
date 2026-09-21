import React from "react";
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
  if (!open) return null;

  const instanceId = globalThis.crypto.randomUUID();
  const titleId = `confirm-action-title-${instanceId}`;
  const effectId = `confirm-action-effect-${instanceId}`;
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === "Enter" && event.target === event.currentTarget) {
      event.preventDefault();
      onConfirm();
    }
  };

  return (
    <div className="confirm-action-backdrop" role="presentation">
      <div
        className={`confirm-action-dialog${danger ? " confirm-action-dialog-danger" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={effectId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2 id={titleId}>{title}</h2>
        <p id={effectId}>{effectSummary}</p>
        <div className="confirm-action-buttons">
          <button type="button" className="btn btn-ghost" autoFocus onClick={onCancel}>Cancel</button>
          <button type="button" className={`btn${danger ? " btn-danger" : " btn-primary"}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
