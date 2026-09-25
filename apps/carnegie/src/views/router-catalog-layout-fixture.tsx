import { createRoot } from "react-dom/client";
import type { RouterCatalogRead } from "@maestro/contracts";
import "../styles/theme.css";
import "../styles/components.css";
import { RouterCatalogPanel } from "./RouterCatalogPanel.js";

const providers = ["anthropic", "openai", "openai-codex"];
const catalog: RouterCatalogRead = {
  mode: "ensemble",
  active: true,
  status: "ready",
  reason: "Representative fixture catalog.",
  poolModelRefs: [],
  entries: providers.map((providerId, index) => ({
    modelRef: `${providerId}/model-${index + 1}`,
    providerId,
    modelId: `model-${index + 1}`,
    baseline: { present: true, score: 88 - index },
    live: { present: true, capabilities: ["text"], authModes: ["api-key"], regions: ["us"] },
    candidate: { present: true, candidateRefs: [`candidate-${index + 1}`], accountBindings: [`account-${index + 1}`] },
    inUse: index === 0,
    state: "catalog-ready" as const,
  })),
};

const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root element");

createRoot(root).render(
  <div className="app">
    <div className="sidebar" aria-hidden="true" />
    <div className="app-content">
      <div className="settings-wrap">
        <div className="settings-nav" aria-hidden="true" />
        <main className="settings-content">
          <div className="settings-status" role="status">
            Durable settings loaded.
          </div>
          <RouterCatalogPanel
            catalog={catalog}
            loading={false}
            onRefresh={() => undefined}
            onToggle={async () => undefined}
            onValidateConfig={async () => ({
              valid: true,
              enabledModelRefs: [],
              unknownModelRefs: [],
              nonCandidateModelRefs: [],
              changes: [],
            })}
            onApplyConfig={async () => catalog}
          />
          <div className="settings-panel settings-panel-wide" data-testid="providers-panel" aria-hidden="true" />
        </main>
      </div>
    </div>
  </div>,
);
