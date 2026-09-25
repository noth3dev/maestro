import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { type RouterCatalogEntry, type RouterCatalogRead, type RouterConfigInput, type RouterConfigValidation } from "@maestro/contracts";
import { RouterConfigImportPreview } from "./RouterConfigImportPreview.js";
import { createRouterConfigImportController } from "./router-config-import.js";
import { createRouterPoolMutationGate, routerPoolControlsLocked } from "./router-pool-mutation.js";

type RouterCatalogPanelProps = {
  catalog?: RouterCatalogRead | undefined;
  loading: boolean;
  error?: string | undefined;
  onRefresh: () => void;
  onToggle: (modelRef: string, inUse: boolean) => Promise<void>;
  onValidateConfig: (input: RouterConfigInput) => Promise<RouterConfigValidation>;
  onApplyConfig: (input: RouterConfigInput) => Promise<RouterCatalogRead>;
};

export function nextRouterPool(catalog: RouterCatalogRead, modelRef: string, inUse: boolean): string[] {
  const eligible = catalog.entries.filter((entry) => entry.baseline.present && entry.candidate.present).map((entry) => entry.modelRef);
  const eligibleRefs = new Set(eligible);
  const next = new Set(catalog.poolModelRefs.length === 0 ? eligible : catalog.poolModelRefs);
  if (inUse) next.add(modelRef);
  else {
    const enabledCandidateCount = [...next].filter((ref) => eligibleRefs.has(ref)).length;
    if (eligibleRefs.has(modelRef) && next.has(modelRef) && enabledCandidateCount <= 1)
      throw new Error("At least one catalog candidate must remain enabled");
    next.delete(modelRef);
  }
  return next.size === eligible.length && eligible.every((ref) => next.has(ref)) ? [] : [...next].sort();
}

function routerStatusLabel(catalog: RouterCatalogRead): string {
  if (catalog.mode === "pin") return "Pin mode";
  return catalog.status === "ready" ? "Ready" : catalog.status === "partial" ? "Partial" : "Inactive";
}

const routerRowStateLabels: Record<RouterCatalogEntry["state"], string> = {
  routable: "routable",
  "pool-disabled": "pool disabled",
  "live-unavailable": "not listed in live Gateway catalog",
  "live-unknown": "live Gateway catalog not checked",
  unprofiled: "unprofiled",
  "not-a-candidate": "not a candidate",
  "candidate-unknown": "candidate status unknown",
  "catalog-ready": "catalog ready",
};
const routerRowStateFilterValues: RouterCatalogEntry["state"][] = [
  "catalog-ready",
  "pool-disabled",
  "live-unavailable",
  "live-unknown",
  "unprofiled",
  "not-a-candidate",
  "candidate-unknown",
  "routable",
];

function routerRowCanToggle(entry: RouterCatalogEntry): boolean {
  return entry.baseline.present && entry.candidate.present === true;
}

export function RouterRow({
  entry,
  busy,
  locked,
  lockStatusId,
  onToggle,
}: {
  entry: RouterCatalogEntry;
  busy: boolean;
  locked: boolean;
  lockStatusId: string;
  onToggle: (entry: RouterCatalogEntry) => void;
}) {
  const canToggle = routerRowCanToggle(entry);
  const disabledReason = !entry.baseline.present
    ? "Unprofiled — add a human-owned model profile before enabling."
    : entry.candidate.present === null
      ? "Candidate catalog unavailable; membership and account binding are not checked. Restore/configure the catalog, then refresh."
      : entry.candidate.present === false
        ? "Not a candidate — configure an explicit account binding before enabling."
        : entry.live.present === null
          ? "Live Gateway catalog not checked; availability is unconfirmed."
          : entry.live.present === false
            ? "Not listed in the live Gateway catalog."
            : undefined;
  const disabledReasonId = `router-disabled-${encodeURIComponent(entry.modelRef)}`;
  const descriptionIds = [locked && canToggle ? lockStatusId : undefined, disabledReason !== undefined ? disabledReasonId : undefined]
    .filter((id): id is string => id !== undefined)
    .join(" ");
  return (
    <tr className={!canToggle ? "router-catalog-row is-disabled" : undefined}>
      <td>
        <span className="router-model-id">{entry.modelId}</span>
        <span className="router-model-ref">{entry.modelRef}</span>
      </td>
      <td>{entry.baseline.present ? (entry.baseline.score === null ? "unscored" : entry.baseline.score.toFixed(1)) : "not profiled"}</td>
      <td>
        {entry.live.present === true ? (
          <span className="badge badge-olive">listed</span>
        ) : entry.live.present === false ? (
          <span className="badge badge-slate">not listed in live Gateway catalog</span>
        ) : (
          <span className="badge badge-slate">not checked in live Gateway catalog</span>
        )}
      </td>
      <td>
        {entry.candidate.present === true ? (
          <>
            <span>{entry.candidate.candidateRefs.join(", ")}</span>
            <span className="router-model-ref">{entry.candidate.accountBindings.join(", ")}</span>
          </>
        ) : entry.candidate.present === null ? (
          <>
            <span className="badge badge-slate">candidate membership not checked</span>
            <span className="router-model-ref">account binding not checked</span>
          </>
        ) : (
          <span className="badge badge-slate">not a candidate</span>
        )}
      </td>
      <td>
        <button
          type="button"
          role="switch"
          aria-checked={entry.inUse}
          aria-label={`${entry.inUse ? "Disable" : "Enable"} ${entry.modelRef}`}
          aria-describedby={descriptionIds || undefined}
          className={`router-toggle${entry.inUse ? " on" : ""}`}
          disabled={!canToggle || busy || locked}
          onClick={() => onToggle(entry)}
        >
          {busy ? "saving…" : entry.inUse ? "in use" : "enable"}
        </button>
        {disabledReason !== undefined && (
          <span id={disabledReasonId} className="router-disabled-reason">
            {disabledReason}
          </span>
        )}
      </td>
      <td>
        <span className={`router-state router-state-${entry.state}`}>{routerRowStateLabels[entry.state]}</span>
      </td>
    </tr>
  );
}

export function RouterCatalogPanel({
  catalog,
  loading,
  error,
  onRefresh,
  onToggle,
  onValidateConfig,
  onApplyConfig,
}: RouterCatalogPanelProps) {
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [inUseFilter, setInUseFilter] = useState("all");
  const [busyModelRef, setBusyModelRef] = useState<string | undefined>();
  const [poolMutationBusy, setPoolMutationBusy] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>();
  const [importPreview, setImportPreview] = useState<{ input: RouterConfigInput; result: RouterConfigValidation } | undefined>();
  const [importError, setImportError] = useState<string | undefined>();
  const [validatingImport, setValidatingImport] = useState(false);
  const [applyingImport, setApplyingImport] = useState(false);
  const applyingImportRef = useRef(false);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const importUploadButtonRef = useRef<HTMLButtonElement>(null);
  const restoreImportFocusRef = useRef(false);
  const importControllerRef = useRef<ReturnType<typeof createRouterConfigImportController> | null>(null);
  if (importControllerRef.current === null) importControllerRef.current = createRouterConfigImportController();
  const poolMutationGateRef = useRef<ReturnType<typeof createRouterPoolMutationGate> | null>(null);
  if (poolMutationGateRef.current === null) poolMutationGateRef.current = createRouterPoolMutationGate();

  useEffect(() => {
    if (importPreview !== undefined || applyingImport || !restoreImportFocusRef.current) return;
    restoreImportFocusRef.current = false;
    importUploadButtonRef.current?.focus();
  }, [importPreview, applyingImport]);

  const entries = catalog?.entries ?? [];
  const providers = [...new Set(entries.map((entry) => entry.providerId))].sort();
  const filteredEntries = entries.filter((entry) => {
    const query = search.trim().toLowerCase();
    return (
      (query === "" ||
        entry.modelRef.toLowerCase().includes(query) ||
        entry.providerId.toLowerCase().includes(query) ||
        entry.modelId.toLowerCase().includes(query)) &&
      (providerFilter === "all" || entry.providerId === providerFilter) &&
      (stateFilter === "all" || entry.state === stateFilter) &&
      (inUseFilter === "all" || (inUseFilter === "in-use" ? entry.inUse : !entry.inUse))
    );
  });
  const grouped = providers
    .map((providerId) => ({ providerId, entries: filteredEntries.filter((entry) => entry.providerId === providerId) }))
    .filter((group) => group.entries.length > 0);

  const poolControlsLocked = routerPoolControlsLocked({
    poolMutationBusy,
    validatingImport,
    hasImportPreview: importPreview !== undefined,
    applyingImport,
  });
  const poolLockStatusMessage = applyingImport
    ? undefined
    : poolMutationBusy
      ? "Saving a router-pool update. Wait before changing another row or importing a file."
      : validatingImport
        ? "Checking the config. Row updates and catalog refresh are paused."
        : importPreview !== undefined
          ? "Finish or cancel the import preview before changing rows or refreshing the catalog."
          : undefined;
  const runPoolMutation = async (operation: () => Promise<unknown>): Promise<boolean> => {
    const gate = poolMutationGateRef.current;
    if (gate === null || gate.locked) return false;
    setPoolMutationBusy(true);
    try {
      return await gate.run(operation);
    } finally {
      setPoolMutationBusy(false);
    }
  };

  const downloadConfig = () => {
    if (catalog === undefined) return;
    const payload = JSON.stringify({ schemaVersion: 1, enabledModelRefs: catalog.poolModelRefs }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "maestro-router-config.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const uploadConfig = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    const controller = importControllerRef.current;
    if (
      file === undefined ||
      controller === null ||
      controller.validating ||
      applyingImportRef.current ||
      poolMutationGateRef.current?.locked
    )
      return;
    setImportError(undefined);
    setImportPreview(undefined);
    setValidatingImport(true);
    try {
      const preview = await controller.validate(file, onValidateConfig);
      if (preview !== undefined) setImportPreview(preview);
    } catch (cause: unknown) {
      setImportError(cause instanceof Error ? cause.message : "Router config must be strict JSON with schemaVersion 1.");
    } finally {
      setValidatingImport(false);
    }
  };

  const toggle = async (entry: RouterCatalogEntry) => {
    const gate = poolMutationGateRef.current;
    if (gate === null || gate.locked || importControllerRef.current?.validating || importPreview !== undefined || applyingImportRef.current)
      return;
    setBusyModelRef(entry.modelRef);
    setActionError(undefined);
    try {
      const updated = await runPoolMutation(() => onToggle(entry.modelRef, !entry.inUse));
      if (!updated) throw new Error("Another router-pool update is already in progress.");
    } catch (cause: unknown) {
      setActionError(
        cause instanceof Error ? cause.message : "Router pool update could not be confirmed. Refresh the catalog before retrying.",
      );
    } finally {
      setBusyModelRef(undefined);
    }
  };

  const applyImport = async () => {
    const gate = poolMutationGateRef.current;
    if (importPreview === undefined || !importPreview.result.valid || applyingImportRef.current || gate === null || gate.locked) return;
    applyingImportRef.current = true;
    setApplyingImport(true);
    setImportError(undefined);
    try {
      const updated = await runPoolMutation(() => onApplyConfig(importPreview.input));
      if (!updated) throw new Error("Another router-pool update is already in progress.");
      restoreImportFocusRef.current = true;
      setImportPreview(undefined);
    } catch (cause: unknown) {
      setImportError(
        cause instanceof Error
          ? cause.message
          : "Apply result could not be confirmed. Cancel, refresh the catalog, and re-import before retrying.",
      );
    } finally {
      applyingImportRef.current = false;
      setApplyingImport(false);
    }
  };

  const cancelImportPreview = () => {
    if (applyingImportRef.current) return;
    restoreImportFocusRef.current = true;
    setImportPreview(undefined);
  };
  const importControlsDisabled = poolMutationBusy || validatingImport || applyingImport;

  return (
    <div className="settings-panel settings-panel-wide router-catalog-panel">
      <div className="router-catalog-header">
        <div>
          <div className="settings-section-title">Ensemble Router</div>
          <div className="settings-section-sub">
            Exact provider/model identities from the human baseline, live Gateway, candidate catalog, and operator pool.
          </div>
          <div className="settings-section-sub">
            Pool eligibility reflects only the human profile, explicit candidate, and operator pool; it does not guarantee live, account,
            Goal, or Mission Bundle readiness.
          </div>
        </div>
        <span className={`router-runtime-badge router-runtime-${catalog?.status ?? "inactive"}`}>
          {catalog === undefined ? "Loading" : routerStatusLabel(catalog)}
        </span>
      </div>
      {catalog?.reason !== undefined && (
        <p className="router-catalog-reason" role="status">
          {catalog.reason}
        </p>
      )}
      {catalog?.mode === "pin" && (
        <p className="router-catalog-reason" role="status">
          Pool changes affect this display only until Ensemble mode is enabled.
        </p>
      )}
      {loading && (
        <p role="status" aria-busy="true">
          Loading Router Catalog…
        </p>
      )}
      {error !== undefined && (
        <p className="router-catalog-error" role="alert">
          {error}
        </p>
      )}
      {!loading && error === undefined && catalog !== undefined && (
        <>
          <div className="router-catalog-actions">
            <button
              type="button"
              className="btn btn-sm"
              disabled={poolControlsLocked}
              aria-describedby={poolControlsLocked ? "router-pool-lock-status" : undefined}
              onClick={onRefresh}
            >
              refresh
            </button>
            <button type="button" className="btn btn-sm" onClick={downloadConfig}>
              download operator config
            </button>
            <button
              ref={importUploadButtonRef}
              type="button"
              className="btn btn-sm router-upload-button"
              aria-disabled={importControlsDisabled}
              disabled={applyingImport}
              onClick={() => {
                if (!importControlsDisabled) importFileInputRef.current?.click();
              }}
            >
              upload operator config
            </button>
            <input
              ref={importFileInputRef}
              className="router-file-input"
              type="file"
              accept="application/json,.json"
              disabled={importControlsDisabled}
              aria-hidden="true"
              tabIndex={-1}
              onChange={(event) => void uploadConfig(event)}
            />
          </div>
          <div className="router-catalog-filters" aria-label="Router Catalog filters">
            <label>
              search{" "}
              <input
                className="input"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Provider, model id, or provider/model"
              />
            </label>
            <label>
              Provider{" "}
              <select className="input" value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}>
                <option value="all">all providers</option>
                {providers.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
            </label>
            <label>
              state{" "}
              <select className="input" value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}>
                <option value="all">all states</option>
                {routerRowStateFilterValues.map((state) => (
                  <option key={state} value={state}>
                    {routerRowStateLabels[state]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              use{" "}
              <select className="input" value={inUseFilter} onChange={(event) => setInUseFilter(event.target.value)}>
                <option value="all">all rows</option>
                <option value="in-use">in use</option>
                <option value="not-in-use">not in use</option>
              </select>
            </label>
          </div>
          {poolLockStatusMessage !== undefined && (
            <p
              id="router-pool-lock-status"
              className="router-catalog-reason"
              role="status"
              aria-busy={poolMutationBusy || validatingImport}
            >
              {poolLockStatusMessage}
            </p>
          )}
          {actionError !== undefined && (
            <p className="router-catalog-error" role="alert">
              {actionError}
            </p>
          )}
          {importError !== undefined && (
            <p className="router-catalog-error" role="alert">
              {importError}
            </p>
          )}
          {importPreview !== undefined && (
            <RouterConfigImportPreview
              validation={importPreview.result}
              entries={entries}
              applying={applyingImport}
              onCancel={cancelImportPreview}
              onApply={() => void applyImport()}
            />
          )}
          {grouped.length === 0 ? (
            <p className="router-catalog-empty" role="status">
              No Router Catalog rows match these filters.
            </p>
          ) : (
            grouped.map((group) => (
              <section className="router-provider-group" key={group.providerId} aria-labelledby={`router-provider-${group.providerId}`}>
                <h3 id={`router-provider-${group.providerId}`}>{group.providerId}</h3>
                <div className="router-table-wrap" role="region" aria-label={`${group.providerId} Router Catalog model table`} tabIndex={0}>
                  <table className="router-catalog-table">
                    <thead>
                      <tr>
                        <th scope="col">model</th>
                        <th scope="col">baseline</th>
                        <th scope="col">live</th>
                        <th scope="col">candidate / account</th>
                        <th scope="col">in use</th>
                        <th scope="col">router state</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.entries.map((entry) => (
                        <RouterRow
                          key={entry.modelRef}
                          entry={entry}
                          busy={busyModelRef === entry.modelRef}
                          locked={poolControlsLocked}
                          lockStatusId="router-pool-lock-status"
                          onToggle={(row) => void toggle(row)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))
          )}
        </>
      )}
      {!loading && error === undefined && catalog === undefined && (
        <p role="status">Router Catalog unavailable until durable settings load successfully.</p>
      )}
    </div>
  );
}
