import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { BootstrapStatus, PublicConnectionConfig } from "./global.js";

interface ConnectionContextValue {
  config: PublicConnectionConfig | undefined;
  loading: boolean;
  connect: (input: { apiUrl: string; token: string; projectId: string }) => Promise<void>;
  disconnect: () => Promise<void>;
  setupError: string | undefined;
  bootstrap: BootstrapStatus;
}

const ConnectionContext = createContext<ConnectionContextValue | undefined>(undefined);

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
      const [loaded, error, status] = await Promise.all([
        window.maestro.config.get(),
        window.maestro.config.error(),
        window.maestro.bootstrap.status(),
      ]);
      if (!active || generation !== refreshGeneration) return;
      setConfig(loaded);
      setSetupError(error);
      setBootstrap(status);
      setLoading(status.phase === "starting");
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
