import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ConnectionProvider, SessionRecoveryNotice, useConnection } from "./connection.js";
import { GoalsProvider } from "./goals.js";
import { ThemeProvider } from "./theme.js";
import { I18nProvider, localeFromPreferences, useT, type Locale } from "./i18n/index.js";
import { Sidebar } from "./components/Sidebar.js";
import { Setup } from "./views/Setup.js";
import { Home } from "./views/Home.js";
import { Dashboard } from "./views/Dashboard.js";
import { Planning } from "./views/Planning.js";
import { Channel } from "./views/Channel.js";
import { Git } from "./views/Git.js";
import { Floor } from "./views/Floor.js";
import { Inbox } from "./views/Inbox.js";
import { EvidenceLog } from "./views/EvidenceLog.js";
import { Billing } from "./views/Billing.js";
import { Settings } from "./views/Settings.js";
import { Persona } from "./views/Persona.js";
import { Luthiery } from "./views/Luthiery.js";
import { Arrangements } from "./views/Arrangements.js";
import { Flashmob } from "./views/Flashmob.js";
import { FlashmobSession } from "./views/FlashmobSession.js";
import type { ViewName } from "./views.js";
import type { HomeMode } from "./homeMode.js";
import type { EventQuery } from "@maestro/api-client";
import { createRendererEventStream } from "../electron/event-stream-bridge.js";
import { useDurableEvents, type UseDurableEventsResult } from "./useDurableEvents.js";
import { bootstrapProgressText } from "./bootstrap-status.js";

function Shell({ eventState }: { eventState: UseDurableEventsResult }) {
  const [view, setView] = useState<ViewName>("home");
  const [homeMode, setHomeMode] = useState<HomeMode>("maestro");

  const body = (() => {
    switch (view) {
      case "home": return <Home onNavigate={setView} mode={homeMode} onModeChange={setHomeMode} />;
      case "dashboard": return <Dashboard onNavigate={setView} eventState={eventState} />;
      case "planning": return <Planning onNavigate={setView} />;
      case "channel": return <Channel onNavigate={setView} eventCursor={eventState.cursor} />;
      case "git": return <Git onBack={() => setView("channel")} />;
      case "floor": return <Floor onBack={() => setView("home")} eventCursor={eventState.cursor} />;
      case "inbox": return <Inbox onNavigate={setView} />;
      case "evlog": return <EvidenceLog onNavigate={setView} eventCursor={eventState.cursor} />;
      case "billing": return <Billing />;
      case "settings": return <Settings />;
      case "persona": return <Persona />;
      case "luthiery": return <Luthiery />;
      case "arrangements": return <Arrangements />;
      case "flashmob": return <Flashmob onOpenSession={() => setView("flashmobSession")} />;
      case "flashmobSession": return <FlashmobSession onBack={() => setView("flashmob")} />;
    }
  })();

  const noSidebar = view === "git" || view === "flashmobSession";
  const contentIsMainLandmark = !["dashboard", "planning", "settings"].includes(view);

  return (
    <div className={`app${homeMode === "flashmob" ? " flashmob-theme" : ""}`}>
      {!noSidebar && <Sidebar view={view} onNavigate={setView} />}
      <div
        className="app-content"
        id="workspace-focus-target"
        tabIndex={-1}
        {...(contentIsMainLandmark ? { role: "main", "aria-label": "Maestro workspace" } : {})}
      >
        {eventState.stale && (
          <div className="event-stale-banner" role="status" aria-live="polite" aria-atomic="true">
            <span>Showing the last durable state while live updates reconnect.{eventState.error === undefined ? "" : ` ${eventState.error}`}</span>
            <button type="button" className="btn btn-sm" onClick={eventState.retry}>retry live updates</button>
          </div>
        )}
        {body}
      </div>
    </div>
  );
}

function ConnectedWorkspace({ projectId }: { projectId: string }) {
  const durableEventsApi = useMemo(() => ({
    listEvents: (query: EventQuery) => window.maestro.api.listEvents(query),
    streamEvents: (query: EventQuery, options?: { signal?: AbortSignal; onConnected?: () => void }) =>
      createRendererEventStream(window.maestro.events.subscribe, query, options?.signal, options?.onConnected),
  }), []);
  const eventState = useDurableEvents(durableEventsApi, projectId);
  return (
    <GoalsProvider refreshKey={eventState.cursor}>
      <Shell eventState={eventState} />
    </GoalsProvider>
  );
}

function Connected() {
  const t = useT();
  const { config, loading, retryingBootstrap, workspaceFocusRequest, bootstrap, recovery, retryConnection, disconnect } = useConnection();
  const wasRetryingBootstrap = useRef(false);
  const lastWorkspaceFocusRequest = useRef(workspaceFocusRequest);
  const bootstrapStatusText = bootstrapProgressText(
    bootstrap,
    t.setup.starting,
    t.setup.progressSteps,
    t.setup.completedProgressSteps,
    t.setup.retryFailed,
  );

  useLayoutEffect(() => {
    if (workspaceFocusRequest !== lastWorkspaceFocusRequest.current) {
      lastWorkspaceFocusRequest.current = workspaceFocusRequest;
      document.getElementById("workspace-focus-target")?.focus();
    }
  }, [workspaceFocusRequest]);

  useLayoutEffect(() => {
    if (wasRetryingBootstrap.current && !retryingBootstrap) {
      const targetId = config !== undefined
        ? "workspace-focus-target"
        : recovery !== undefined
          ? "session-recovery"
          : "setup-retry-button";
      const target = document.getElementById(targetId) ?? document.getElementById("setup-title");
      target?.focus();
    }
    wasRetryingBootstrap.current = retryingBootstrap;
  }, [config, recovery, retryingBootstrap]);

  if (loading && !retryingBootstrap) {
    return (
      <div className="app">
        <main className="home-main" aria-label={t.setup.starting}>
          <h1 className="home-title" tabIndex={-1}>{t.setup.starting}</h1>
          <p className="form-hint" role="status" aria-live="polite" aria-atomic="true">
            {bootstrapStatusText}
          </p>
        </main>
      </div>
    );
  }
  if (recovery !== undefined) {
    const clearSavedSession = recovery.action === "sign-in-again" || recovery.action === "repair-storage";
    return <SessionRecoveryNotice recovery={recovery} onAction={() => { if (clearSavedSession) void disconnect(); else retryConnection(); }} />;
  }
  if (config === undefined) return <Setup />;
  return <ConnectedWorkspace projectId={config.projectId} />;
}

function LocalizedApp() {
  const [locale, setLocale] = useState<Locale>("en");

  useEffect(() => {
    if (typeof window === "undefined" || window.maestro === undefined) return;
    void window.maestro.preferences.get()
      .then((preferences) => setLocale(localeFromPreferences(preferences.locale)))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = locale;
  }, [locale]);

  return (
    <I18nProvider locale={locale}>
      <ThemeProvider>
        <ConnectionProvider>
          <Connected />
        </ConnectionProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

export function App() {
  return <LocalizedApp />;
}
