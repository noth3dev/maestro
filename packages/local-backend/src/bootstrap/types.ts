import type { EmbeddedDatabaseHandle } from "@maestro/persistence";
import type { ConnectionEnvironment } from "../connection.js";

export interface LocalSecretStore {
  read(): string | undefined;
  write(value: string): void;
  clear(): void;
}

export interface LocalCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type LocalCommandRunner = (
  file: string,
  args: readonly string[],
  options?: { cwd?: string; env?: Record<string, string | undefined>; signal?: AbortSignal },
) => Promise<LocalCommandResult>;

export interface LocalProcessHandle {
  stop(): Promise<void>;
}

export interface LocalModelGatewayLaunchOptions {
  entry: string;
  apiUrl: string;
  token: string;
  operatorId: string;
  codexCommand?: string;
  codexModels?: string;
}

export interface LocalControlPlaneLaunchOptions {
  entry: string;
  databaseUrl: string;
  dataDir: string;
  apiUrl: string;
  modelGatewayUrl: string;
  modelGatewayToken: string;
  modelGatewayOperatorId: string;
  modelRoutingMode?: "ensemble" | "pin";
  nativeModelRef?: string;
  ensembleCandidateCatalogPath?: string;
  modelAccountRefs?: string;
  modelMapPath?: string;
}

export interface LocalBootstrapOptions {
  env: ConnectionEnvironment;
  fetch?: typeof globalThis.fetch;
  secretStore?: LocalSecretStore;
  runCommand?: LocalCommandRunner;
  startControlPlane?: (options: LocalControlPlaneLaunchOptions) => Promise<LocalProcessHandle | void>;
  startModelGateway?: (options: LocalModelGatewayLaunchOptions) => Promise<LocalProcessHandle | void>;
  startEmbeddedDatabase?: (options: {
    dataDir: string;
    detached?: boolean;
    port?: number;
    signal?: AbortSignal;
  }) => Promise<EmbeddedDatabaseHandle>;
  retryDelayMs?: number;
  signal?: AbortSignal;
  onStep?: (event: LocalBootstrapStepEvent) => void;
  includeProjectId?: boolean;
}

export const LOCAL_BOOTSTRAP_STEP_ORDER = ["docker-check", "postgres-ready", "migrations", "control-plane-up", "model-gateway-up"] as const;

export type LocalBootstrapStepName = (typeof LOCAL_BOOTSTRAP_STEP_ORDER)[number];
export type LocalBootstrapStepStatus = "pending" | "started" | "completed" | "failed";

export interface LocalBootstrapStepEvent {
  readonly step: LocalBootstrapStepName;
  readonly status: LocalBootstrapStepStatus;
  readonly message?: string;
}
