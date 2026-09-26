import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { BootstrapStatus, MaestroBridge, PublicConnectionConfig } from "./global.js";
import { safeBootstrapErrorMessage, sanitizeRendererBootstrapStatus } from "./bootstrap-status.js";

export type SessionRecovery =
  | { kind: "invalid-session"; action: "sign-in-again"; message: string }
  | { kind: "unauthorized"; action: "reconnect"; message: string }
  | { kind: "durable-store-unavailable"; action: "repair-storage"; message: string }
  | { kind: "reconnect-required"; action: "retry"; message: string };

type ErrorWithStatus = { status?: unknown; code?: unknown; message?: unknown };

function errorDetails(error: unknown): ErrorWithStatus {
  return error instanceof Error ? error : typeof error === "object" && error !== null ? (error as ErrorWithStatus) : {};
}

export function isSessionFailure(error: unknown): boolean {
  const details = errorDetails(error);
  const message = typeof details.message === "string" ? details.message.toLowerCase() : "";
  return (
    details.status === 401 ||
    details.code === "authentication_required" ||
    details.code === "session_invalid" ||
    message.includes("stored control-plane token") ||
    message.includes("session is invalid") ||
    message.includes("session expired")
  );
}

export function classifySessionRecovery(error: unknown): SessionRecovery {
  const details = errorDetails(error);
  const message = typeof details.message === "string" ? details.message.toLowerCase() : "";
  if (
    message.includes("stored control-plane token") ||
    message.includes("durable store") ||
    message.includes("session could not be read")
  ) {
    return {
      kind: "durable-store-unavailable",
      action: "repair-storage",
      message: "The saved session could not be read. Repair or reconnect the local session.",
    };
  }
  if (message.includes("session") && (message.includes("invalid") || message.includes("expired") || details.code === "session_invalid")) {
    return { kind: "invalid-session", action: "sign-in-again", message: "Your session is invalid. Sign in again." };
  }
  if (details.status === 401 || details.code === "authentication_required") {
    return { kind: "unauthorized", action: "reconnect", message: "The Control Plane rejected this session. Reconnect to continue." };
  }
  return { kind: "reconnect-required", action: "retry", message: "The Control Plane is unreachable. Retry the connection." };
}

interface ConnectionContextValue {
  config: PublicConnectionConfig | undefined;
  loading: boolean;
  connect: (input: { apiUrl: string; token: string; projectId: string }) => Promise<void>;
  disconnect: () => Promise<void>;
  retryConnection: () => void;
  retryBootstrap: () => Promise<void>;
  workspaceFocusRequest: number;
  retryingBootstrap: boolean;
  recovery: SessionRecovery | undefined;
  reportSessionFailure: (error: unknown) => void;
  setupError: string | undefined;
  bootstrap: BootstrapStatus;
}

const ConnectionContext = createContext<ConnectionContextValue | undefined>(undefined);

type ConnectionRefreshSource = {
  config: Pick<MaestroBridge["config"], "get" | "error">;
  bootstrap: Pick<MaestroBridge["bootstrap"], "status">;
};

interface ConnectionState {
  config: PublicConnectionConfig | undefined;
  setupError: string | undefined;
  bootstrap: BootstrapStatus;
}

function errorMessage(error: unknown): string {
  return safeBootstrapErrorMessage(error, "Could not load the local workspace");
}

export async function readConnectionState(source: ConnectionRefreshSource): Promise<ConnectionState> {
  const [loaded, error, status] = await Promise.allSettled([source.config.get(), source.config.error(), source.bootstrap.status()]);
  const bootstrap =
    status.status === "fulfilled"
      ? sanitizeRendererBootstrapStatus(status.value)
      : { phase: "setup-required" as const, reason: errorMessage(status.reason) };
  const bootstrapReason = bootstrap.phase === "setup-required" ? bootstrap.reason : undefined;
  const setupError =
    error.status === "fulfilled"
      ? (error.value ?? bootstrapReason)
      : bootstrap.phase === "starting"
        ? undefined
        : (bootstrapReason ?? errorMessage(loaded.status === "rejected" ? loaded.reason : error.reason));
  return {
    config: bootstrap.phase === "setup-required" || loaded.status !== "fulfilled" ? undefined : loaded.value,
    setupError: setupError === undefined ? undefined : safeBootstrapErrorMessage(setupError),
    bootstrap,
  };
}

export function sessionRecoveryForConnectionState(state: ConnectionState): SessionRecovery | undefined {
  if (state.bootstrap.phase === "setup-required") return undefined;
  if (state.setupError === undefined || state.bootstrap.phase === "starting") return undefined;
  return classifySessionRecovery(new Error(state.setupError));
}

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConnectionConfig | undefined>(undefined);
  const [setupError, setSetupError] = useState<string | undefined>(undefined);
  const [bootstrap, setBootstrap] = useState<BootstrapStatus>({ phase: "starting" });
  const [loading, setLoading] = useState(true);
  const [retryingBootstrap, setRetryingBootstrap] = useState(false);
  const [workspaceFocusRequest, setWorkspaceFocusRequest] = useState(0);
  const connectionOperation = useRef<"manual-connect" | "bootstrap-retry" | undefined>(undefined);
  const [recovery, setRecovery] = useState<SessionRecovery | undefined>(undefined);
  const [refreshGeneration, setRefreshGeneration] = useState(0);

  useEffect(() => {
    let active = true;
    let readGeneration = 0;
    const refresh = async (): Promise<void> => {
      const generation = ++readGeneration;
      const state = await readConnectionState(window.maestro);
      if (!active || generation !== readGeneration) return;
      setConfig(state.config);
      setSetupError(state.setupError);
      setBootstrap(state.bootstrap);
      setLoading(state.bootstrap.phase === "starting");
      if (state.bootstrap.phase !== "starting") setRetryingBootstrap(false);
      setRecovery(sessionRecoveryForConnectionState(state));
    };
    const unsubscribe = window.maestro.bootstrap.onStatus((status) => {
      if (!active) return;
      const safeStatus = sanitizeRendererBootstrapStatus(status);
      setBootstrap(safeStatus);
      if (safeStatus.phase === "starting") {
        readGeneration += 1;
        setLoading(true);
        return;
      }
      if (safeStatus.phase === "setup-required") {
        setConfig(undefined);
        setSetupError(safeStatus.reason);
        setRecovery(undefined);
      }
      void refresh();
    });
    void refresh();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [refreshGeneration]);

  const connect: ConnectionContextValue["connect"] = async (input) => {
    if (connectionOperation.current !== undefined || retryingBootstrap) {
      throw new Error("Another local connection operation is already in progress");
    }
    connectionOperation.current = "manual-connect";
    try {
      const saved = await window.maestro.config.save(input);
      setConfig(saved);
      setSetupError(undefined);
      setRecovery(undefined);
      setWorkspaceFocusRequest((current) => current + 1);
    } finally {
      connectionOperation.current = undefined;
    }
  };

  const disconnect: ConnectionContextValue["disconnect"] = async () => {
    await window.maestro.config.clear();
    const reason = "Control Plane connection is not configured";
    setConfig(undefined);
    setSetupError(reason);
    setBootstrap({ phase: "setup-required", reason });
    setRecovery(undefined);
  };

  const retryConnection = () => {
    setRecovery(undefined);
    setRefreshGeneration((current) => current + 1);
  };

  const retryBootstrap: ConnectionContextValue["retryBootstrap"] = async () => {
    if (connectionOperation.current !== undefined || retryingBootstrap) return;
    connectionOperation.current = "bootstrap-retry";
    setRetryingBootstrap(true);
    setLoading(true);
    setRecovery(undefined);
    try {
      await window.maestro.bootstrap.retry();
      setRefreshGeneration((current) => current + 1);
    } catch (error) {
      const reason = errorMessage(error);
      setConfig(undefined);
      setSetupError(reason);
      setBootstrap({ phase: "setup-required", reason, canRetryLocal: true });
      setLoading(false);
      setRetryingBootstrap(false);
      throw error;
    } finally {
      connectionOperation.current = undefined;
    }
  };

  const reportSessionFailure = useCallback((error: unknown) => setRecovery(classifySessionRecovery(error)), []);

  return (
    <ConnectionContext.Provider
      value={{
        config,
        loading,
        connect,
        disconnect,
        retryConnection,
        retryBootstrap,
        retryingBootstrap,
        workspaceFocusRequest,
        recovery,
        reportSessionFailure,
        setupError,
        bootstrap,
      }}
    >
      {children}
    </ConnectionContext.Provider>
  );
}

export function SessionRecoveryNotice({ recovery, onAction }: { recovery: SessionRecovery; onAction: () => void }) {
  const actionLabels: Record<SessionRecovery["action"], string> = {
    "sign-in-again": "sign in again",
    reconnect: "reconnect",
    "repair-storage": "repair saved session",
    retry: "retry connection",
  };
  return (
    <main id="session-recovery" className="home-main" tabIndex={-1}>
      <h1 className="home-title">session recovery</h1>
      <p className="form-hint" role="alert">
        {recovery.message}
      </p>
      <button type="button" className="btn btn-primary" onClick={onAction}>
        {actionLabels[recovery.action]}
      </button>
    </main>
  );
}

export function useConnection(): ConnectionContextValue {
  const value = useContext(ConnectionContext);
  if (value === undefined) throw new Error("useConnection must be used within a ConnectionProvider");
  return value;
}
