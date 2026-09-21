import { useEffect, useMemo, useState } from "react";
import { ConnectionProvider, useConnection } from "./connection.js";
import { GoalsProvider } from "./goals.js";
import { ThemeProvider } from "./theme.js";
import { I18nProvider, localeFromPreferences, type Locale } from "./i18n/index.js";
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

function Shell({ eventState }: { eventState: UseDurableEventsResult }) {
  const [view, setView] = useState<ViewName>("home");
  const [homeMode, setHomeMode] = useState<HomeMode>("maestro");

  const body = (() => {
    switch (view) {
      case "home": return <Home onNavigate={setView} mode={homeMode} onModeChange={setHomeMode} />;
      case "dashboard": return <Dashboard onNavigate={setView} eventState={eventState} />;
      case "planning": return <Planning onNavigate={setView} />;
      case "channel": return <Channel onNavigate={setView} />;
      case "git": return <Git onBack={() => setView("channel")} />;
      case "floor": return <Floor onBack={() => setView("home")} eventCursor={eventState.cursor} />;
      case "inbox": return <Inbox onNavigate={setView} />;
      case "evlog": return <EvidenceLog onNavigate={setView} />;
      case "billing": return <Billing />;
      case "settings": return <Settings />;
      case "persona": return <Persona />;
      case "luthiery": return <Luthiery />;
      case "arrangements": return <Arrangements />;
      case "flashmob": return <Flashmob onOpenSession={() => setView("flashmobSession")} />;
      case "flashmobSession": return <FlashmobSession onBack={() => setView("flashmob")} onPromote={() => setView("dashboard")} />;
    }
  })();

  const noSidebar = view === "git" || view === "flashmobSession";

  return (
    <div className={`app${homeMode === "flashmob" ? " flashmob-theme" : ""}`}>
      {!noSidebar && <Sidebar view={view} onNavigate={setView} />}
      <div className="app-content">
        {eventState.stale && (
          <div className="event-stale-banner" role="status">
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
    <GoalsProvider>
      <Shell eventState={eventState} />
    </GoalsProvider>
  );
}

function Connected() {
  const { config, loading } = useConnection();
  if (loading) return <div className="app" aria-busy="true" />;
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
