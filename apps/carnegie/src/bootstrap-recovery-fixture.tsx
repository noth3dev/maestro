import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles/theme.css";
import "./styles/components.css";

type FixtureStatus =
  | { phase: "starting"; step?: { step: string; status: string } }
  | { phase: "ready" }
  | { phase: "setup-required"; reason: string; canRetryLocal: boolean };

declare global {
  interface Window {
    __bootstrapRetryCount: number;
    __manualConnectCount: number;
    __delayConfigSave: boolean;
    __releaseConfigSave: (() => void) | undefined;
    __publishBootstrapStatus: (status: unknown) => void;
    __completeBootstrapRetry: ((outcome: "failure" | "success") => void) | undefined;
    __delayConnectionReads: boolean;
    __releaseConnectionReads: (() => void) | undefined;
  }
}

const searchParams = new URLSearchParams(window.location.search);
const canRetryLocal = searchParams.get("retry") !== "unavailable";
const reasonByFixtureCase: Record<string, string> = {
  "db-engine": "MAESTRO_LOCAL_DB_ENGINE must be embedded or docker",
  "db-port": "MAESTRO_EMBEDDED_DATABASE_PORT must be an integer from 1 to 65535",
  "docker-container": "Docker PostgreSQL exists but could not be started; run `docker logs maestro-local-postgres`",
  unknown: "Model gateway is running but not ready",
};
const initialReason =
  reasonByFixtureCase[searchParams.get("reason") ?? ""] ??
  "Docker is required for local automatic setup but is not available; install/start Docker or set MAESTRO_LOCAL_DATABASE_URL";
let bootstrapStatus: FixtureStatus = { phase: "setup-required", reason: initialReason, canRetryLocal };
const listeners = new Set<(status: FixtureStatus) => void>();
window.__bootstrapRetryCount = 0;
window.__manualConnectCount = 0;
window.__delayConfigSave = false;
window.__releaseConfigSave = undefined;
window.__delayConnectionReads = false;
window.__releaseConnectionReads = undefined;
window.__completeBootstrapRetry = undefined;

function publish(status: FixtureStatus): void {
  bootstrapStatus = status;
  for (const listener of listeners) listener(status);
}

window.__publishBootstrapStatus = (status) => publish(status as FixtureStatus);

const bridge = {
  api: {
    listEvents: async () => ({ events: [], nextCursor: "0" }),
    listGoals: async () => ({ goals: [], nextCursor: undefined }),
    listModels: async () => [],
  },
  config: {
    get: async () => {
      if (window.__delayConnectionReads) {
        await new Promise<void>((resolve) => {
          window.__releaseConnectionReads = resolve;
        });
      }
      return { apiUrl: "http://127.0.0.1:4310", projectId: "saved-project" };
    },
    error: async () => (bootstrapStatus.phase === "setup-required" ? bootstrapStatus.reason : undefined),
    save: async ({ apiUrl, projectId }: { apiUrl: string; token: string; projectId: string }) => {
      window.__manualConnectCount += 1;
      if (window.__delayConfigSave) {
        await new Promise<void>((resolve) => {
          window.__releaseConfigSave = resolve;
        });
      }
      return { apiUrl, projectId };
    },
    clear: async () => undefined,
  },
  bootstrap: {
    status: async () => bootstrapStatus,
    retry: async () => {
      window.__bootstrapRetryCount += 1;
      publish({ phase: "starting", step: { step: "docker-check", status: "started" } });
      await new Promise<void>((resolve) => {
        window.__completeBootstrapRetry = (outcome) => {
          publish(
            outcome === "success" ? { phase: "ready" } : { phase: "setup-required", reason: "Docker is unavailable", canRetryLocal: true },
          );
          window.__completeBootstrapRetry = undefined;
          resolve();
        };
      });
    },
    onStatus: (listener: (status: FixtureStatus) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  },
  external: { openProviderAuth: async () => undefined },
  preferences: {
    get: async () => ({ theme: "dark", locale: new URLSearchParams(window.location.search).get("locale") ?? "en" }),
    save: async () => undefined,
  },
  windowControls: {
    minimize: () => undefined,
    toggleMaximize: async () => false,
    isMaximized: async () => false,
    close: () => undefined,
    onStateChange: () => () => undefined,
  },
  events: { subscribe: () => () => undefined },
} as unknown as Window["maestro"];

window.maestro = bridge;
const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root element");
createRoot(root).render(<App />);
