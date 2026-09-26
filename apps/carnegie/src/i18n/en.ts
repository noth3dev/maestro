export const en = {
  nav: {
    concertmaster: "concertmaster",
    newSession: "new session",
    untitledSession: "untitled session",
    inbox: "inbox",
    dashboard: "dashboard",
    planning: "planning",
    flashmob: "flashmob",
    kanban: "board",
    evidenceLog: "evidence log",
    billing: "billing",
    luthiery: "luthiery",
    arrangements: "arrangements",
    newGoal: "new goal",
  },
  common: {
    send: "send",
    approve: "approve",
    deny: "deny",
    save: "save",
    cancel: "cancel",
    back: "back",
    loading: "loading…",
    retry: "retry",
    staleNotice: "Showing the last known state while reconnecting…",
    notConnectedTitle: "Not connected yet",
    notConnectedHint:
      "This part of Maestro doesn't have a real backend to talk to yet — the screen is here so the shape is right, and it will light up as the control plane grows into it.",
  },
  setup: {
    title: "Set up Maestro",
    hint: "Maestro usually starts its local workspace automatically. If that fails, fix the reason and retry, or connect to an existing local Control Plane.",
    retryHint:
      "Fix the issue described above. If it names a MAESTRO_* setting, update the environment used to launch Carnegie and restart Carnegie before retrying. If a Control Plane is already running on this computer, use Manual connection below.",
    databaseEngineRecoveryHint:
      "Set MAESTRO_LOCAL_DB_ENGINE to embedded or docker, or remove it to use the embedded default. Update the environment used to launch Carnegie, then restart Carnegie before retrying local setup.",
    databasePortRecoveryHint:
      "Set MAESTRO_EMBEDDED_DATABASE_PORT to an integer from 1 to 65535, or remove it to use the default. Update the environment used to launch Carnegie, then restart Carnegie before retrying local setup.",
    dockerUnavailableRecoveryHint:
      "Start Docker, then retry local setup. To use a database URL instead, set MAESTRO_LOCAL_DATABASE_URL in the environment used to launch Carnegie and restart Carnegie.",
    dockerDiagnosticsRecoveryHint: "Run the Docker diagnostic command shown in the reason above, then retry local setup.",
    retryLocal: "Retry local setup",
    retryingLocal: "Starting local setup…",
    retryFailed: "Local setup did not complete. Review the reason above, then retry.",
    starting: "Starting local workspace…",
    progressSteps: {
      "docker-check": "checking Docker availability…",
      "postgres-ready": "starting the local database…",
      migrations: "running database migrations…",
      "control-plane-up": "starting the Control Plane…",
      "model-gateway-up": "starting the model gateway…",
    },
    completedProgressSteps: {
      "docker-check": "Docker is available.",
      "postgres-ready": "The local database is ready.",
      migrations: "Database migrations are complete.",
      "control-plane-up": "The Control Plane is ready.",
      "model-gateway-up": "The model gateway is ready.",
    },
    manualTitle: "Manual connection",
    manualHint: "Only Control Planes running on this computer can be used here.",
    apiUrl: "Control plane URL",
    token: "Operator token",
    projectId: "Project ID",
    connect: "Connect",
    connecting: "Connecting…",
  },
} as const;

type WidenStrings<T> = T extends string ? string : { [K in keyof T]: WidenStrings<T[K]> };
export type Translations = WidenStrings<typeof en>;
