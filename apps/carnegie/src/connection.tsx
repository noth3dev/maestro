import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { BootstrapStatus, MaestroBridge, PublicConnectionConfig } from "./global.js";

export type SessionRecovery =
  | { kind: "invalid-session"; action: "sign-in-again"; message: string }
  | { kind: "unauthorized"; action: "reconnect"; message: string }
  | { kind: "durable-store-unavailable"; action: "repair-storage"; message: string }
  | { kind: "reconnect-required"; action: "retry"; message: string };

type ErrorWithStatus = { status?: unknown; code?: unknown; message?: unknown };

function errorDetails(error: unknown): ErrorWithStatus {
  return error instanceof Error ? error : typeof error === "object" && error !== null ? error as ErrorWithStatus : {};
}

export function isSessionFailure(error: unknown): boolean {
  const details = errorDetails(error);
  const message = typeof details.message === "string" ? details.message.toLowerCase() : "";
  return details.status === 401 || details.code === "authentication_required" || details.code === "session_invalid" ||
    message.includes("stored control-plane token") || message.includes("session is invalid") || message.includes("session expired");
}

export function classifySessionRecovery(error: unknown): SessionRecovery {
  const details = errorDetails(error);
  const message = typeof details.message === "string" ? details.message.toLowerCase() : "";
  if (message.includes("stored control-plane token") || message.includes("durable store") || message.includes("session could not be read")) {
    return { kind: "durable-store-unavailable", action: "repair-storage", message: "The saved session could not be read. Repair or reconnect the local session." };
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
  return error instanceof Error ? error.message : "Could not load the local workspace";
}

export async function readConnectionState(source: ConnectionRefreshSource): Promise<ConnectionState> {
  const [loaded, error, status] = await Promise.allSettled([
    source.config.get(),
    source.config.error(),
    source.bootstrap.status(),
  ]);
  const bootstrap = status.status === "fulfilled"
    ? status.value
    : { phase: "setup-required" as const, reason: errorMessage(status.reason) };
  return {
    config: loaded.status === "fulfilled" ? loaded.value : undefined,
    setupError: error.status === "fulfilled"
      ? error.value
      : bootstrap.phase === "starting"
        ? undefined
        : errorMessage(loaded.status === "rejected" ? loaded.reason : error.reason),
    bootstrap,
  };
}

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConnectionConfig | undefined>(undefined);
  const [setupError, setSetupError] = useState<string | undefined>(undefined);
  const [bootstrap, setBootstrap] = useState<BootstrapStatus>({ phase: "starting" });
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState<SessionRecovery | undefined>(undefined);
  const [refreshGeneration, setRefreshGeneration] = useState(0);

  useEffect(() => {
    let active = true;
    let refreshGeneration = 0;
    const refresh = async (): Promise<void> => {
      const generation = ++refreshGeneration;
      const state = await readConnectionState(window.maestro);
      if (!active || generation !== refreshGeneration) return;
      setConfig(state.config);
      setSetupError(state.setupError);
      setBootstrap(state.bootstrap);
      setLoading(state.bootstrap.phase === "starting");
      setRecovery(state.setupError === undefined || state.bootstrap.phase === "starting" ? undefined : classifySessionRecovery(new Error(state.setupError)));
    };
    const unsubscribe = window.maestro.bootstrap.onStatus((status) => {
      if (!active) return;
      setBootstrap(status);
      if (status.phase !== "starting") void refresh();
    });
    void refresh();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [refreshGeneration]);

  const connect: ConnectionContextValue["connect"] = async (input) => {
    const saved = await window.maestro.config.save(input);
    setConfig(saved);
    setSetupError(undefined);
    setRecovery(undefined);
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

  const reportSessionFailure = useCallback((error: unknown) => setRecovery(classifySessionRecovery(error)), []);

  return <ConnectionContext.Provider value={{ config, loading, connect, disconnect, retryConnection, recovery, reportSessionFailure, setupError, bootstrap }}>{children}</ConnectionContext.Provider>;
}

export function SessionRecoveryNotice({ recovery, onAction }: { recovery: SessionRecovery; onAction: () => void }) {
  const actionLabels: Record<SessionRecovery["action"], string> = {
    "sign-in-again": "sign in again",
    reconnect: "reconnect",
    "repair-storage": "repair saved session",
    retry: "retry connection",
  };
  return (
    <div className="home-main" role="alert">
      <div className="home-title">session recovery</div>
      <p className="form-hint">{recovery.message}</p>
      <button type="button" className="btn btn-primary" onClick={onAction}>{actionLabels[recovery.action]}</button>
    </div>
  );
}

export function useConnection(): ConnectionContextValue {
  const value = useContext(ConnectionContext);
  if (value === undefined) throw new Error("useConnection must be used within a ConnectionProvider");
  return value;
}
