import React, { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { ConversationSummary } from "@maestro/contracts";
import { useConnection } from "./connection.js";

interface SessionsContextValue {
  /** Durable Concertmaster sessions, most recently active first; undefined while the first load is pending. */
  sessions: readonly ConversationSummary[] | undefined;
  error: string | undefined;
  /** The open session, or undefined for a new, not-yet-started one. */
  activeConversationId: string | undefined;
  openSession: (conversationId: string | undefined) => void;
  /** Increments each time the operator asks for a fresh session. */
  newSessionRequest: number;
  refresh: () => Promise<void>;
}

const SessionsContext = createContext<SessionsContextValue | undefined>(undefined);

export function SessionsProvider({ children }: { children: ReactNode }) {
  const { config } = useConnection();
  const projectId = config?.projectId;
  const [sessions, setSessions] = useState<readonly ConversationSummary[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [activeConversationId, setActiveConversationId] = useState<string | undefined>(undefined);
  const [newSessionRequest, setNewSessionRequest] = useState(0);
  const openSession = useCallback((conversationId: string | undefined) => {
    setActiveConversationId(conversationId);
    if (conversationId === undefined) setNewSessionRequest((current) => current + 1);
  }, []);

  const refresh = useCallback(async () => {
    if (projectId === undefined) return;
    try {
      setSessions(await window.maestro.api.listConversations({ projectId }));
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sessions are unavailable");
    }
  }, [projectId]);

  useEffect(() => {
    setSessions(undefined);
    setActiveConversationId(undefined);
    void refresh();
  }, [refresh]);

  return (
    <SessionsContext.Provider value={{ sessions, error, activeConversationId, openSession, newSessionRequest, refresh }}>
      {children}
    </SessionsContext.Provider>
  );
}

export function useSessions(): SessionsContextValue {
  const value = useContext(SessionsContext);
  if (value === undefined) throw new Error("useSessions must be used within a SessionsProvider");
  return value;
}
