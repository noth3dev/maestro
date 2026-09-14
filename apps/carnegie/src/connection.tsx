import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { PublicConnectionConfig } from "./global.js";

interface ConnectionContextValue {
  config: PublicConnectionConfig | undefined;
  loading: boolean;
  connect: (input: { apiUrl: string; token: string; projectId: string }) => Promise<void>;
  disconnect: () => Promise<void>;
}

const ConnectionContext = createContext<ConnectionContextValue | undefined>(undefined);

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConnectionConfig | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void window.maestro.config.get().then((loaded) => {
      setConfig(loaded);
      setLoading(false);
    });
  }, []);

  const connect: ConnectionContextValue["connect"] = async (input) => {
    const saved = await window.maestro.config.save(input);
    setConfig(saved);
  };

  const disconnect: ConnectionContextValue["disconnect"] = async () => {
    await window.maestro.config.clear();
    setConfig(undefined);
  };

  return <ConnectionContext.Provider value={{ config, loading, connect, disconnect }}>{children}</ConnectionContext.Provider>;
}

export function useConnection(): ConnectionContextValue {
  const value = useContext(ConnectionContext);
  if (value === undefined) throw new Error("useConnection must be used within a ConnectionProvider");
  return value;
}
