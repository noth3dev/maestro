import { useState } from "react";
import { ConnectionProvider } from "./connection.js";
import { GoalsProvider } from "./goals.js";
import { ThemeProvider } from "./theme.js";
import { I18nProvider } from "./i18n/index.js";
import { Sidebar } from "./components/Sidebar.js";
import { Home } from "./views/Home.js";
import { Dashboard } from "./views/Dashboard.js";
import { Channel } from "./views/Channel.js";
import { Git } from "./views/Git.js";
import { Floor } from "./views/Floor.js";
import { Inbox } from "./views/Inbox.js";
import { EvidenceLog } from "./views/EvidenceLog.js";
import { Billing } from "./views/Billing.js";
import { Settings } from "./views/Settings.js";
import { Luthiery } from "./views/Luthiery.js";
import { Arrangements } from "./views/Arrangements.js";
import { Flashmob } from "./views/Flashmob.js";
import { FlashmobSession } from "./views/FlashmobSession.js";
import type { ViewName } from "./views.js";
import type { HomeMode } from "./homeMode.js";

function Shell() {
  const [view, setView] = useState<ViewName>("home");
  const [homeMode, setHomeMode] = useState<HomeMode>("maestro");

  const body = (() => {
    switch (view) {
      case "home": return <Home onNavigate={setView} mode={homeMode} onModeChange={setHomeMode} />;
      case "dashboard": return <Dashboard onNavigate={setView} />;
      case "channel": return <Channel onNavigate={setView} />;
      case "git": return <Git onBack={() => setView("channel")} />;
      case "floor": return <Floor onBack={() => setView("home")} />;
      case "inbox": return <Inbox onNavigate={setView} />;
      case "evlog": return <EvidenceLog onNavigate={setView} />;
      case "billing": return <Billing />;
      case "settings": return <Settings />;
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
      {body}
    </div>
  );
}

function Connected() {
  // ponytail: the real Setup gate (`config === undefined` -> <Setup />) is wired and working, just
  // not enforced yet — nothing needs a live control plane to look at the UI shell right now. Remove
  // this bypass once the write flows (Task Contract intake, approvals) are ready to go through a
  // real connection again.
  return (
    <GoalsProvider>
      <Shell />
    </GoalsProvider>
  );
}

export function App() {
  return (
    <I18nProvider locale="en">
      <ThemeProvider>
        <ConnectionProvider>
          <Connected />
        </ConnectionProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}
