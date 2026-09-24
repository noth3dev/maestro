import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  type ProviderAccountLoginStartResult,
  type ProviderAccountLoginStatus,
  type RouterCatalogEntry,
  type RouterCatalogRead,
  type RouterConfigInput,
  type RouterConfigValidation,
} from "@maestro/contracts";
import { Icon } from "../icons.js";
import { useTheme } from "../theme.js";
import { isSessionFailure, useConnection } from "../connection.js";
import { ToggleSwitch } from "../components/ToggleSwitch.js";
import { isProviderAuthUrlAllowed, waitForProviderAccountLogin } from "../lib/provider-account-login.js";
import { createSettingsStore, raisesAuthority, redactSecret, type SettingsApi } from "../lib/settings-data.js";
import { RouterConfigImportPreview } from "./RouterConfigImportPreview.js";
import { createRouterConfigImportController } from "./router-config-import.js";
import { createRouterPoolMutationGate, routerPoolControlsLocked } from "./router-pool-mutation.js";
export { routerConfigDocument } from "./router-config-import.js";

type Panel = "profile" | "appearance" | "connection" | "notifications" | "providers" | "models" | "authority" | "danger";

export type AccountLoginProviderId = "openai-codex" | "anthropic-claude";

export type AccountLoginPanelState = {
  loginState: "idle" | "opening" | "waiting" | "connected" | "error";
  message?: string | undefined;
  url?: string | undefined;
  linkCopied: boolean;
};

export const initialAccountLoginPanelState: AccountLoginPanelState = { loginState: "idle", linkCopied: false };

type AccountLoginRef = { loginId?: string | undefined; abort?: AbortController | undefined };

type AccountLoginApi = {
  startAccountLogin(providerId: AccountLoginProviderId): Promise<ProviderAccountLoginStartResult>;
  accountLoginStatus(providerId: AccountLoginProviderId, loginId: string): Promise<ProviderAccountLoginStatus>;
  cancelAccountLogin(providerId: AccountLoginProviderId, loginId: string): Promise<void>;
  logoutAccount(providerId: AccountLoginProviderId): Promise<void>;
};

export function createAccountLoginController(deps: {
  providerId: AccountLoginProviderId;
  label: string;
  ref: AccountLoginRef;
  api: AccountLoginApi;
  openExternal: (url: string) => Promise<void>;
  refreshProviderSettings: () => Promise<void>;
  getBusy: () => string | undefined;
  setBusy: (value: string | undefined) => void;
  setPanelState: (patch: Partial<AccountLoginPanelState>) => void;
  setConnected: (connected: boolean) => void;
}) {
  const { providerId, label, ref, api, openExternal, refreshProviderSettings, getBusy, setBusy, setPanelState, setConnected } = deps;

  const start = async () => {
    if (getBusy() !== undefined) return;
    const controller = new AbortController();
    ref.abort = controller;
    ref.loginId = undefined;
    setBusy(providerId);
    setPanelState({ loginState: "opening", message: undefined });
    try {
      const started = await api.startAccountLogin(providerId);
      if (!isProviderAuthUrlAllowed(started.authUrl)) throw new Error("The provider returned an unsafe authentication URL.");
      ref.loginId = started.loginId;
      setPanelState({ url: started.authUrl });
      let browserOpened = true;
      try {
        await openExternal(started.authUrl);
      } catch {
        browserOpened = false;
      }
      setPanelState({ loginState: "waiting" });
      if (!browserOpened) setPanelState({ message: "The browser did not open. Use the sign-in link below." });
      await waitForProviderAccountLogin((loginId) => api.accountLoginStatus(providerId, loginId), started.loginId, {
        signal: controller.signal,
      });
      setConnected(true);
      setPanelState({ loginState: "connected" });
      try {
        await refreshProviderSettings();
        setPanelState({ message: `${label} is ready for Maestro.` });
      } catch {
        setPanelState({ message: `${label} is connected. Settings will refresh on the next load.` });
      }
    } catch (cause: unknown) {
      if (controller.signal.aborted) return;
      const loginId = ref.loginId;
      if (loginId !== undefined) {
        try {
          await api.cancelAccountLogin(providerId, loginId);
        } catch {
          /* preserve the original sign-in error */
        }
      }
      setPanelState({ loginState: "error", message: cause instanceof Error ? cause.message : `Could not complete ${label} login.` });
    } finally {
      if (ref.abort === controller) ref.abort = undefined;
      ref.loginId = undefined;
      setBusy(undefined);
    }
  };

  const cancel = async () => {
    const loginId = ref.loginId;
    ref.abort?.abort();
    if (loginId !== undefined) {
      try {
        await api.cancelAccountLogin(providerId, loginId);
      } catch {
        /* the local cancellation still stops polling */
      }
    }
    ref.loginId = undefined;
    ref.abort = undefined;
    setBusy(undefined);
    setPanelState({ loginState: "idle", message: undefined, url: undefined, linkCopied: false });
  };

  const logout = async () => {
    setBusy(providerId);
    try {
      await api.logoutAccount(providerId);
      setConnected(false);
      setPanelState({ loginState: "idle", message: undefined, url: undefined, linkCopied: false });
      await refreshProviderSettings();
    } catch (cause: unknown) {
      setPanelState({ loginState: "error", message: cause instanceof Error ? cause.message : `Could not disconnect ${label}.` });
    } finally {
      setBusy(undefined);
    }
  };

  const copyLink = async (url: string | undefined) => {
    if (url === undefined) return;
    try {
      await navigator.clipboard.writeText(url);
      setPanelState({ linkCopied: true });
      window.setTimeout(() => setPanelState({ linkCopied: false }), 1800);
    } catch {
      setPanelState({ message: "Copy was blocked. Select the sign-in link manually." });
    }
  };

  return { start, cancel, logout, copyLink };
}

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
                <div className="router-table-wrap">
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

export function Settings() {
  const { theme, setTheme } = useTheme();
  const { config, disconnect, reportSessionFailure } = useConnection();
  const [disconnecting, setDisconnecting] = useState(false);
  const [panel, setPanel] = useState<Panel>("profile");
  const [settings, setSettings] = useState<Awaited<ReturnType<typeof window.maestro.api.getSettings>> | undefined>();
  const settingsStore = useRef<ReturnType<typeof createSettingsStore> | undefined>(undefined);
  if (settingsStore.current === undefined) settingsStore.current = createSettingsStore(window.maestro.api as SettingsApi);
  const [settingsError, setSettingsError] = useState<string | undefined>();
  const [pendingAuthority, setPendingAuthority] = useState<Parameters<typeof window.maestro.api.updateSettingsAuthorityDefaults>[0] | undefined>();
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [routerCatalog, setRouterCatalog] = useState<RouterCatalogRead | undefined>();
  const [routerCatalogError, setRouterCatalogError] = useState<string | undefined>();
  const [routerCatalogLoading, setRouterCatalogLoading] = useState(false);
  const [providerSecret, setProviderSecret] = useState("");
  const [providerBusy, setProviderBusy] = useState<string | undefined>();
  const [accountLoginPanels, setAccountLoginPanels] = useState<Record<AccountLoginProviderId, AccountLoginPanelState>>({
    "openai-codex": initialAccountLoginPanelState,
    "anthropic-claude": initialAccountLoginPanelState,
  });
  const [connectedAccounts, setConnectedAccounts] = useState<Record<AccountLoginProviderId, boolean>>({
    "openai-codex": false,
    "anthropic-claude": false,
  });
  const accountLoginRefs = useRef<Record<AccountLoginProviderId, { loginId?: string; abort?: AbortController }>>({
    "openai-codex": {},
    "anthropic-claude": {},
  });
  const isDark = theme === "dark";

  const loadSettings = () => {
    setSettingsLoading(true);
    setSettingsError(undefined);
    void settingsStore.current!.load()
      .then((value) => { setSettings(value); })
      .catch((cause: unknown) => { if (isSessionFailure(cause)) reportSessionFailure(cause); setSettings(undefined); setSettingsError("Durable settings are unavailable. No settings were loaded."); })
      .finally(() => setSettingsLoading(false));
  };
  const loadRouterCatalog = useCallback(() => {
    setRouterCatalogLoading(true);
    setRouterCatalogError(undefined);
    void window.maestro.api.getRouterCatalog().then(setRouterCatalog).catch(() => {
      setRouterCatalog(undefined);
      setRouterCatalogError("Router Catalog is unavailable. No routing state was loaded.");
    }).finally(() => setRouterCatalogLoading(false));
  }, []);
  useEffect(() => {
    loadSettings();
    void settingsStore.current!.listProviderConnections().then((connections) => {
      setConnectedAccounts((current) => ({
        "openai-codex":
          current["openai-codex"] ||
          connections.some((provider) => provider.providerId === "openai-codex" && provider.connected),
        "anthropic-claude":
          current["anthropic-claude"] ||
          connections.some((provider) => provider.providerId === "anthropic-claude" && provider.connected),
      }));
    }).catch(() => { /* durable settings remains the source of truth when this optional refresh is unavailable */ });
    return () => {
      accountLoginRefs.current["openai-codex"].abort?.abort();
      accountLoginRefs.current["anthropic-claude"].abort?.abort();
    };
  }, []);
  useEffect(() => {
    if (panel === "models") loadRouterCatalog();
  }, [loadRouterCatalog, panel]);
  // A failed write must not hide the last server-confirmed snapshot.
  const settingsReady = settings !== undefined;
  const updatePreferences = (patch: Parameters<typeof window.maestro.api.updateSettingsPreferences>[0]) => {
    void settingsStore.current!.updatePreferences(patch)
      .then((value) => { setSettings(value); setSettingsError(undefined); })
      .catch(() => setSettingsError("Durable settings update failed; saved values remain unchanged."));
  };
  const updateDefaults = (patch: Parameters<typeof window.maestro.api.updateSettingsAuthorityDefaults>[0]) => {
    void settingsStore.current!.updateAuthorityDefaults(patch)
      .then((value) => { setSettings(value); setSettingsError(undefined); setPendingAuthority(undefined); })
      .catch(() => setSettingsError("Durable settings update failed; saved values remain unchanged."));
  };
  const requestAuthorityUpdate = (patch: Parameters<typeof window.maestro.api.updateSettingsAuthorityDefaults>[0]) => {
    if (settings === undefined) return;
    if (raisesAuthority(settings.authorityDefaults, patch)) setPendingAuthority(patch);
    else updateDefaults(patch);
  };
  const toggleRouterModel = async (modelRef: string, inUse: boolean) => {
    if (routerCatalog === undefined) throw new Error("Router Catalog is not loaded");
    const input: RouterConfigInput = { schemaVersion: 1, enabledModelRefs: nextRouterPool(routerCatalog, modelRef, inUse) };
    const next = await window.maestro.api.replaceRouterConfig(input);
    setRouterCatalog(next);
  };
  const validateRouterConfig = (input: RouterConfigInput) => window.maestro.api.validateRouterConfig(input);
  const applyRouterConfig = async (input: RouterConfigInput) => {
    const next = await window.maestro.api.replaceRouterConfig(input);
    setRouterCatalog(next);
    return next;
  };
  const providers = settings?.providers ?? [];
  const isAccountProviderConnected = (providerId: AccountLoginProviderId) =>
    connectedAccounts[providerId] || providers.some((provider) => provider.providerId === providerId && provider.connected);
  const refreshProviderSettings = async () => {
    const nextSettings = await settingsStore.current!.load();
    setSettings(nextSettings);
    setSettingsError(undefined);
    try {
      const connections = await settingsStore.current!.listProviderConnections();
      setConnectedAccounts((current) => ({
        "openai-codex":
          current["openai-codex"] ||
          connections.some((provider) => provider.providerId === "openai-codex" && provider.connected),
        "anthropic-claude":
          current["anthropic-claude"] ||
          connections.some((provider) => provider.providerId === "anthropic-claude" && provider.connected),
      }));
    } catch {
      // The completed login is still reflected locally while the gateway catalog catches up.
    }
  };
  const providerAction = async (providerId: "openai" | "anthropic") => {
    setProviderBusy(providerId);
    try {
      if (providers.some((provider) => provider.providerId === providerId && provider.connected)) {
        await settingsStore.current!.logoutProvider(providerId);
      } else if (providerSecret.trim() !== "") {
        await settingsStore.current!.loginProvider({ providerId, authMode: "api-key", secret: providerSecret });
      } else {
        return;
      }
      await refreshProviderSettings();
    } catch (cause: unknown) {
      if (isSessionFailure(cause)) reportSessionFailure(cause);
      const message = cause instanceof Error ? cause.message : "Provider status is unavailable; no connection state was changed.";
      setSettingsError(redactSecret(message, providerSecret));
    } finally {
      // Never retain or render a provider credential after the request settles.
      setProviderSecret("");
      setProviderBusy(undefined);
    }
  };
  const setAccountPanelState = (providerId: AccountLoginProviderId, patch: Partial<AccountLoginPanelState>) => {
    setAccountLoginPanels((current) => ({ ...current, [providerId]: { ...current[providerId], ...patch } }));
  };
  const setAccountConnectedFor = (providerId: AccountLoginProviderId, connected: boolean) => {
    setConnectedAccounts((current) => ({ ...current, [providerId]: connected }));
  };
  const accountLoginControllers: Record<AccountLoginProviderId, ReturnType<typeof createAccountLoginController>> = {
    "openai-codex": createAccountLoginController({
      providerId: "openai-codex",
      label: "ChatGPT / Codex",
      ref: accountLoginRefs.current["openai-codex"],
      api: window.maestro.api,
      openExternal: window.maestro.external.openProviderAuth,
      refreshProviderSettings,
      getBusy: () => providerBusy,
      setBusy: setProviderBusy,
      setPanelState: (patch) => setAccountPanelState("openai-codex", patch),
      setConnected: (connected) => setAccountConnectedFor("openai-codex", connected),
    }),
    "anthropic-claude": createAccountLoginController({
      providerId: "anthropic-claude",
      label: "Claude Pro/Max",
      ref: accountLoginRefs.current["anthropic-claude"],
      api: window.maestro.api,
      openExternal: window.maestro.external.openProviderAuth,
      refreshProviderSettings,
      getBusy: () => providerBusy,
      setBusy: setProviderBusy,
      setPanelState: (patch) => setAccountPanelState("anthropic-claude", patch),
      setConnected: (connected) => setAccountConnectedFor("anthropic-claude", connected),
    }),
  };

  const navItem = (id: Panel, icon: string, label: string) => (
    <button
      key={id}
      type="button"
      className={`settings-nav-item${panel === id ? " on" : ""}`}
      aria-current={panel === id ? "page" : undefined}
      onClick={() => setPanel(id)}
    >
      <Icon name={icon} /> {label}
    </button>
  );

  return (
    <div className="settings-wrap">
      <div className="settings-nav">
        <div className="settings-nav-group-label">account</div>
        {navItem("profile", "user", "profile")}
        {navItem("appearance", "palette", "appearance")}
        {navItem("notifications", "bell", "notifications")}

        {navItem("connection", "server", "connection")}

        <div className="settings-nav-group-label">workspace</div>
        {navItem("providers", "plug", "providers")}
        {navItem("models", "cpu", "Ensemble Router")}
        {navItem("authority", "shield", "approvals & authority")}

        <div className="settings-nav-divider" />
        {navItem("danger", "triangle-alert", "danger zone")}
      </div>

      <main className="settings-content">
      <div className="settings-status" role="status">
        {settingsLoading ? <span>Loading durable settings…</span> : settingsError ? <><span role="alert">{settingsError}</span> <button className="btn btn-sm" onClick={loadSettings}>retry</button></> : <span>Durable settings loaded.</span>}
      </div>

      {panel === "profile" && (
        <div className="settings-panel">
          <div className="settings-section-title">profile</div>
          <div className="settings-section-sub">profile editing is unavailable until a durable profile route exists</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
            <div className="avatar avatar-lg av-slate" aria-label="Profile identity unavailable">--</div>
            <button className="btn btn-sm" disabled title="Profile editing is not connected to a durable route">change avatar</button>
          </div>
          <div className="form-field" style={{ marginBottom: 14 }}>
            <label className="form-label" htmlFor="settings-display-name">display name</label>
            <input id="settings-display-name" className="input" type="text" value="Unavailable" readOnly disabled />
          </div>
          <div className="form-field">
            <label className="form-label" htmlFor="settings-email">email</label>
            <input id="settings-email" className="input" type="text" value="Unavailable" readOnly disabled />
            <span className="form-hint">used for critical-action email alerts</span>
          </div>
        </div>
      )}

      {panel === "appearance" && (
        <div className="settings-panel">
          <div className="settings-section-title">appearance</div>
          <div className="settings-section-sub">theme and density</div>
          <div className="settings-row">
            <div><div className="settings-row-label">dark mode</div><div className="settings-row-hint">follows this toggle, not the OS setting</div></div>
            <ToggleSwitch label="Dark mode" on={isDark} onToggle={() => setTheme(isDark ? "light" : "dark")} />
          </div>
          <div className="settings-row">
            <div><div className="settings-row-label">compact sidebar</div><div className="settings-row-hint">start collapsed on launch</div></div>
            {settingsReady ? <ToggleSwitch label="Compact sidebar" on={settings.preferences.compactSidebar} onToggle={() => updatePreferences({ compactSidebar: !settings.preferences.compactSidebar })} /> : <span className="badge">unavailable</span>}
          </div>
        </div>
      )}

      {panel === "connection" && (
        <div className="settings-panel">
          <div className="settings-section-title">connection</div>
          <div className="settings-section-sub">the real control plane this Carnegie instance is connected to</div>
          {config === undefined ? (
            <p>Not connected.</p>
          ) : (
            <>
              <div className="form-field" style={{ marginBottom: 14 }}>
                <label className="form-label" htmlFor="settings-control-plane-url">control plane URL</label>
                <input id="settings-control-plane-url" className="input" type="text" value={config.apiUrl} readOnly />
              </div>
              <div className="form-field" style={{ marginBottom: 20 }}>
                <label className="form-label" htmlFor="settings-project-id">project ID</label>
                <input id="settings-project-id" className="input" type="text" value={config.projectId} readOnly />
              </div>
              <button
                className="btn btn-sm"
                style={{ borderColor: "var(--rust)", color: "var(--rust-text)" }}
                disabled={disconnecting}
                onClick={() => {
                  setDisconnecting(true);
                  void disconnect().finally(() => setDisconnecting(false));
                }}
              >
                {disconnecting ? "disconnecting…" : "disconnect"}
              </button>
            </>
          )}
        </div>
      )}

      {panel === "notifications" && (
        <div className="settings-panel">
          <div className="settings-section-title">notifications</div>
          <div className="settings-section-sub">how you hear about approvals and certifications</div>
          <div className="settings-row">
            <div><div className="settings-row-label">desktop push</div><div className="settings-row-hint">approval needed, certification complete</div></div>
            {settingsReady ? <ToggleSwitch label="Desktop push" on={settings.preferences.desktopPush} onToggle={() => updatePreferences({ desktopPush: !settings.preferences.desktopPush })} /> : <span className="badge">unavailable</span>}
          </div>
          <div className="settings-row">
            <div><div className="settings-row-label">email digest</div><div className="settings-row-hint">daily summary of goal activity</div></div>
            {settingsReady ? <ToggleSwitch label="Email digest" on={settings.preferences.emailDigest} onToggle={() => updatePreferences({ emailDigest: !settings.preferences.emailDigest })} /> : <span className="badge">unavailable</span>}
          </div>
          <div className="settings-row">
            <div><div className="settings-row-label">slack webhook</div><div className="settings-row-hint">mirror #general into a workspace channel</div></div>
            {settingsReady ? <ToggleSwitch label="Slack webhook" on={settings.preferences.slackWebhook} onToggle={() => updatePreferences({ slackWebhook: !settings.preferences.slackWebhook })} /> : <span className="badge">unavailable</span>}
          </div>
        </div>
      )}

      {panel === "providers" && (
        <div className="settings-panel settings-panel-wide">
          <div className="settings-section-title">providers</div>
          <div className="settings-section-sub">Connect a model provider once. Credentials stay behind the authenticated Model Gateway.</div>
          {settingsReady ? <>
            {(
              [
                {
                  providerId: "openai-codex" as const,
                  icon: "message-circle",
                  title: "ChatGPT / Codex",
                  description: "Use your existing ChatGPT account for Maestro. Carnegie opens the secure sign-in in your browser.",
                  connectLabel: "sign in with ChatGPT",
                },
                {
                  providerId: "anthropic-claude" as const,
                  icon: "message-circle",
                  title: "Claude Pro/Max",
                  description: "Use your existing Claude Pro/Max account for Maestro. Carnegie opens the secure sign-in in your browser.",
                  connectLabel: "sign in with Claude",
                },
              ] as const
            ).map(({ providerId, icon, title, description, connectLabel }) => {
              const connected = isAccountProviderConnected(providerId);
              const panelState = accountLoginPanels[providerId];
              const controller = accountLoginControllers[providerId];
              return (
                <section className="provider-account-card" aria-labelledby={`${providerId}-provider-title`} key={providerId}>
                  <div className="provider-account-head">
                    <div className="provider-account-icon"><Icon name={icon} /></div>
                    <div className="provider-account-copy">
                      <h2 id={`${providerId}-provider-title`}>{title}</h2>
                      <p>{description}</p>
                    </div>
                    <span
                      className={`badge ${connected ? "badge-olive" : panelState.loginState === "error" ? "badge-rust" : "badge-slate"}`}
                    >
                      {connected
                        ? "connected"
                        : panelState.loginState === "waiting"
                          ? "waiting for sign-in"
                          : panelState.loginState === "opening"
                            ? "opening browser"
                            : panelState.loginState === "error"
                              ? "needs attention"
                              : "not connected"}
                    </span>
                  </div>
                  <div className="provider-account-actions">
                    {connected ? (
                      <button className="btn btn-sm" disabled={providerBusy === providerId} onClick={() => void controller.logout()}>
                        {providerBusy === providerId ? "disconnecting…" : "disconnect"}
                      </button>
                    ) : panelState.loginState === "waiting" || panelState.loginState === "opening" ? (
                      <button className="btn btn-sm" disabled={providerBusy !== undefined} onClick={() => void controller.cancel()}>
                        cancel sign-in
                      </button>
                    ) : (
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={providerBusy !== undefined}
                        onClick={() => void controller.start()}
                      >
                        {panelState.loginState === "error" ? "try again" : connectLabel}
                      </button>
                    )}
                    {panelState.message !== undefined && (
                      <span
                        className={`provider-account-message ${
                          panelState.loginState === "error" ? "is-error" : panelState.loginState === "connected" ? "is-success" : ""
                        }`}
                        role={panelState.loginState === "error" ? "alert" : "status"}
                      >
                        {panelState.message}
                      </span>
                    )}
                  </div>
                  {panelState.url !== undefined && panelState.loginState !== "connected" && (
                    <div className="provider-account-link-box">
                      <span>Sign-in link</span>
                      <div className="provider-account-link-row">
                        <a href={panelState.url} target="_blank" rel="noreferrer">{panelState.url}</a>
                        <button type="button" className="btn btn-sm" onClick={() => void controller.copyLink(panelState.url)}>
                          {panelState.linkCopied ? "copied" : "copy link"}
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              );
            })}

            <div className="provider-api-section">
              <div className="provider-api-heading">API key connections</div>
              <div className="form-field"><label className="form-label" htmlFor="provider-secret">API key</label><input id="provider-secret" className="input" type="password" value={providerSecret} onChange={(event) => setProviderSecret(event.target.value)} placeholder="enter only when connecting" /></div>
              {(["openai", "anthropic"] as const).map((providerId) => { const connected = providers.some((provider) => provider.providerId === providerId && provider.connected); return <div key={providerId} className="provider-row"><Icon name="server" /><span className="provider-row-name">{providerId}</span><span className={`badge ${connected ? "badge-olive" : "badge-slate"}`}>{connected ? "connected" : "not connected"}</span><button className="btn btn-sm" disabled={providerBusy === providerId || (!connected && providerSecret.trim() === "")} onClick={() => void providerAction(providerId)}>{providerBusy === providerId ? "working…" : connected ? "disconnect" : "connect"}</button></div>; })}
            </div>
          </> : <p role="status">Provider status unavailable until durable settings load successfully.</p>}
        </div>
      )}
      {panel === "authority" && (
        <div className="settings-panel">
          <div className="settings-section-title">approvals &amp; authority</div>
          <div className="settings-section-sub">durable defaults applied when new Goals are created</div>
          {pendingAuthority !== undefined && (
            <div className="alert alert-warning" role="alert">
              <strong>This change raises default authority.</strong> New Goals may spend more or skip an approval gate.
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => updateDefaults(pendingAuthority)}>confirm and save</button>
                <button type="button" className="btn btn-sm" onClick={() => setPendingAuthority(undefined)}>cancel</button>
              </div>
            </div>
          )}
          <div className="form-field" style={{ marginBottom: 14 }}>
            <label className="form-label" htmlFor="settings-spend-ceiling">default spend ceiling per goal</label>
            <input id="settings-spend-ceiling" className="input" type="number" min="0" value={settingsReady ? settings.authorityDefaults.spendCeilingCents / 100 : ""} placeholder={settingsReady ? undefined : "unavailable"} disabled={!settingsReady} onChange={(event) => requestAuthorityUpdate({ spendCeilingCents: Math.max(0, Math.round(Number(event.target.value || 0) * 100)) })} />
          </div>
          <div className="settings-row">
            <div><div className="settings-row-label">critical actions always require approval</div><div className="settings-row-hint">deletes, deploys, credential changes</div></div>
            {settingsReady ? <ToggleSwitch label="Critical actions always require approval" on={settings.authorityDefaults.criticalActionsRequireApproval} onToggle={() => requestAuthorityUpdate({ criticalActionsRequireApproval: !settings.authorityDefaults.criticalActionsRequireApproval })} /> : <span className="badge">unavailable</span>}
          </div>
          <div className="settings-row">
            <div><div className="settings-row-label">allow flashmob by default</div><div className="settings-row-hint">light tasks skip full council deliberation</div></div>
            {settingsReady ? <ToggleSwitch label="Allow Flashmob by default" on={settings.authorityDefaults.allowFlashmob} onToggle={() => requestAuthorityUpdate({ allowFlashmob: !settings.authorityDefaults.allowFlashmob })} /> : <span className="badge">unavailable</span>}
          </div>
        </div>
      )}

      {panel === "models" && (
        <RouterCatalogPanel
          catalog={routerCatalog}
          loading={routerCatalogLoading}
          error={routerCatalogError}
          onRefresh={loadRouterCatalog}
          onToggle={toggleRouterModel}
          onValidateConfig={validateRouterConfig}
          onApplyConfig={applyRouterConfig}
        />
      )}

      {panel === "danger" && (
        <div className="settings-panel">
          <div className="settings-section-title">danger zone</div>
          <div className="settings-section-sub">irreversible actions</div>
          <div className="danger-box">
            <div className="danger-box-title">reset workspace</div>
            <div className="danger-box-hint">preview only -- not wired to a real backend yet. clearing durable Goals/evidence must go through the control plane's own authority checks, not this button.</div>
            <button className="btn btn-sm" style={{ borderColor: "var(--rust)", color: "var(--rust-text)" }} disabled title="Not wired to a real backend yet">reset workspace</button>
          </div>
        </div>
      )}
      </main>
    </div>
  );
}
