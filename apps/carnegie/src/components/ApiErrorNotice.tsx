import { Icon } from "../icons.js";
import { useT } from "../i18n/index.js";
import { classifyApiError } from "../lib/command-id.js";

/** A stable, retryable-aware rendering of any error a bridged API call threw. Never renders a token or header. */
export function ApiErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  const { title, detail, retryable } = classifyApiError(error);
  return (
    <div className="api-error-notice" role="alert">
      <Icon name="alert-triangle" />
      <div className="api-error-notice-body">
        <div className="api-error-notice-title">{title}</div>
        <div className="api-error-notice-detail">{detail}</div>
      </div>
      {retryable && onRetry !== undefined ? (
        <button type="button" className="btn btn-sm" onClick={onRetry}>
          <Icon name="refresh-cw" />
          {t.common.retry}
        </button>
      ) : null}
    </div>
  );
}
