import { Icon } from "../icons.js";
import { useT } from "../i18n/index.js";

/** Honest placeholder for a screen whose backend doesn't exist yet — never fake data, never a silently-ignored click. */
export function EmptyState({ title, hint }: { title?: string; hint?: string }) {
  const t = useT();
  return (
    <div className="empty-state">
      <Icon name="plug" />
      <div className="empty-state-title">{title ?? t.common.notConnectedTitle}</div>
      <div className="empty-state-hint">{hint ?? t.common.notConnectedHint}</div>
    </div>
  );
}
