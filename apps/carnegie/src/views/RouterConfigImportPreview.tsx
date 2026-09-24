import { useEffect, useRef } from "react";
import type { RouterCatalogEntry, RouterConfigValidation } from "@maestro/contracts";

type RouterConfigImportPreviewProps = {
  validation: RouterConfigValidation;
  entries: readonly RouterCatalogEntry[];
  applying: boolean;
  onCancel: () => void;
  onApply: () => void;
};

export function RouterConfigImportPreview({ validation, entries, applying, onCancel, onApply }: RouterConfigImportPreviewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const applyingStatusRef = useRef<HTMLParagraphElement>(null);
  const applyButtonRef = useRef<HTMLButtonElement>(null);
  const wasApplying = useRef(false);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  useEffect(() => {
    if (applying) applyingStatusRef.current?.focus();
    else if (wasApplying.current) applyButtonRef.current?.focus();
    wasApplying.current = applying;
  }, [applying]);

  const entryByRef = new Map(entries.map((entry) => [entry.modelRef, entry]));
  const liveOnlyRefs = validation.unknownModelRefs.filter((modelRef) => {
    const entry = entryByRef.get(modelRef);
    return entry !== undefined && entry.live.present && !entry.baseline.present;
  });

  return (
    <section className="router-import-preview" aria-labelledby="router-import-preview-title" aria-busy={applying}>
      <div className="router-import-preview-head">
        <h3 ref={headingRef} id="router-import-preview-title" className="router-import-preview-title" tabIndex={-1}>
          Import preview
        </h3>
        <button type="button" className="btn btn-sm" disabled={applying} onClick={onCancel}>
          cancel
        </button>
      </div>
      <p role="status" aria-live="polite">
        {validation.valid
          ? "Ready to apply. This replaces the operator pool atomically."
          : "Not ready to apply. Unknown model refs must be removed."}
      </p>
      {applying && (
        <p
          ref={applyingStatusRef}
          id="router-pool-lock-status"
          className="router-import-applying-status"
          tabIndex={-1}
          role="status"
          aria-live="polite"
        >
          Applying the operator pool update. Other pool controls are locked. Keep this preview open until it finishes.
        </p>
      )}
      {liveOnlyRefs.length > 0 && (
        <p className="router-catalog-reason" role="status">
          Live-only Gateway models need human-owned profiles before they can be imported: {liveOnlyRefs.join(", ")}
        </p>
      )}
      {validation.nonCandidateModelRefs.length > 0 && (
        <p className="router-catalog-reason" role="status">
          These refs will be saved in the operator pool as preferences, but they cannot route until added to the explicit candidate catalog:{" "}
          {validation.nonCandidateModelRefs.join(", ")}
        </p>
      )}
      {validation.unknownModelRefs.length > 0 && (
        <p className="router-catalog-error" role="alert">
          Unknown model refs: {validation.unknownModelRefs.join(", ")}
        </p>
      )}
      {validation.changes.length > 0 && (
        <ul>
          {validation.changes.map((change) => (
            <li key={change.modelRef}>
              {change.modelRef}: {change.previousInUse ? "in use" : "not in use"} → {change.nextInUse ? "in use" : "not in use"}
            </li>
          ))}
        </ul>
      )}
      <button
        ref={applyButtonRef}
        type="button"
        className="btn btn-primary btn-sm"
        disabled={!validation.valid || applying}
        onClick={onApply}
      >
        {applying ? "applying…" : "apply import"}
      </button>
    </section>
  );
}
