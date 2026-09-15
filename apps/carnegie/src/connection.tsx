import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { PublicConnectionConfig } from "./global.js";

interface ConnectionContextValue {
  config: PublicConnectionConfig | undefined;
  loading: boolean;
  connect: (input: { apiUrl: string; token: string; projectId: string }) => Promise<void>;
  disconnect: () => Promise<void>;
  setupError: string | undefined;
}

const ConnectionContext = createContext<ConnectionContextValue | undefined>(undefined);

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConnectionConfig | undefined>(undefined);
  const [setupError, setSetupError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void Promise.all([window.maestro.config.get(), window.maestro.config.error()]).then(([loaded, setupError]) => {
      setConfig(loaded);
      setSetupError(setupError);
      setLoading(false);
    });
  }, []);

  const connect: ConnectionContextValue["connect"] = async (input) => {
    const saved = await window.maestro.config.save(input);
    setConfig(saved);
    setSetupError(undefined);
  };

  const disconnect: ConnectionContextValue["disconnect"] = async () => {
    await window.maestro.config.clear();
    setConfig(undefined);
    setSetupError(undefined);
  };

  return <ConnectionContext.Provider value={{ config, loading, connect, disconnect, setupError }}>{children}</ConnectionContext.Provider>;
}

export function useConnection(): ConnectionContextValue {
  const value = useContext(ConnectionContext);
  if (value === undefined) throw new Error("useConnection must be used within a ConnectionProvider");
  return value;
}
