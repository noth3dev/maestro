import React from "react";
import type { ReactNode } from "react";
import { ApiErrorNotice } from "./ApiErrorNotice.js";
import { useT } from "../i18n/index.js";

export type AsyncStateStatus = "loading" | "ready" | "empty" | "error";

export interface AsyncStateProps {
  status: AsyncStateStatus;
  children?: ReactNode;
  error?: unknown;
  onRetry?: () => void;
  emptyMessage?: string;
}

/** Shared loading, empty, and error rendering for real API-backed screens. */
export function AsyncState({ status, children, error, onRetry, emptyMessage }: AsyncStateProps): ReactNode {
  const t = useT();
  if (status === "ready") return children ?? null;
  if (status === "loading") {
    return (
      <div className="async-state async-state-loading" role="status" aria-live="polite" aria-busy="true">
        {t.common.loading}
      </div>
    );
  }
  if (status === "empty") {
    return (
      <div className="async-state async-state-empty" role="status" aria-live="polite">
        {emptyMessage ?? "Nothing to show yet."}
      </div>
    );
  }
  const apiError = error ?? new Error("Request failed");
  return onRetry === undefined ? <ApiErrorNotice error={apiError} /> : <ApiErrorNotice error={apiError} onRetry={onRetry} />;
}
