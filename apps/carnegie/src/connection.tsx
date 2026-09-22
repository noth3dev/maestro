import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { BootstrapStatus, MaestroBridge, PublicConnectionConfig } from "./global.js";

interface ConnectionContextValue {
  config: PublicConnectionConfig | undefined;
  loading: boolean;
  connect: (input: { apiUrl: string; token: string; projectId: string }) => Promise<void>;
  disconnect: () => Promise<void>;
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
  }, []);

  const connect: ConnectionContextValue["connect"] = async (input) => {
    const saved = await window.maestro.config.save(input);
    setConfig(saved);
    setSetupError(undefined);
  };

  const disconnect: ConnectionContextValue["disconnect"] = async () => {
    await window.maestro.config.clear();
    const reason = "Control Plane connection is not configured";
    setConfig(undefined);
    setSetupError(reason);
    setBootstrap({ phase: "setup-required", reason });
  };

  return <ConnectionContext.Provider value={{ config, loading, connect, disconnect, setupError, bootstrap }}>{children}</ConnectionContext.Provider>;
}

export function useConnection(): ConnectionContextValue {
  const value = useContext(ConnectionContext);
  if (value === undefined) throw new Error("useConnection must be used within a ConnectionProvider");
  return value;
}
