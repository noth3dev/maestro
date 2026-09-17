import type { IpPythonExecutionResult, IpPythonSessionBinding } from "../ipython-tool.js";
import type { IpPythonEventFrame, IpPythonTransport } from "./frames.js";
import type { IpPythonHostRequest } from "./two-stage.js";

export interface IpPythonKernelOptions {
  readonly transport: IpPythonTransport;
  readonly hostRequest: (
    request: IpPythonHostRequest,
    binding?: IpPythonSessionBinding,
  ) => IpPythonExecutionResult | Promise<IpPythonExecutionResult>;
  readonly onEvent?: (event: Pick<IpPythonEventFrame, "requestId" | "stream" | "text">) => void;
  /** Maximum time allowed for a cooperative interrupt before the child is closed. */
  readonly interruptGraceMs?: number;
  /** Require a version-checked child ready frame before the first cell. */
  readonly requireReady?: boolean;
  readonly readyTimeoutMs?: number;
}

export type IpPythonHostBinding = IpPythonSessionBinding;

export interface IpPythonReadOnlyGateway {
  readFile(binding: IpPythonHostBinding, relativePath: string): IpPythonExecutionResult | Promise<IpPythonExecutionResult>;
  gitRevision(binding: IpPythonHostBinding, ref: string): IpPythonExecutionResult | Promise<IpPythonExecutionResult>;
}

export interface IpPythonReadOnlyValueAdapters {
  readFile(binding: IpPythonHostBinding, relativePath: string): string | Promise<string>;
  gitRevision(binding: IpPythonHostBinding, ref: string): string | Promise<string>;
}

/** Adapt already-authorized file/Git ports into the host protocol result envelope. */
export function createIpPythonReadOnlyGateway(adapters: IpPythonReadOnlyValueAdapters): IpPythonReadOnlyGateway {
  return {
    async readFile(_binding, relativePath) {
      return { state: "ok", dataClass: "workspace", content: await adapters.readFile(_binding, relativePath) };
    },
    async gitRevision(_binding, ref) {
      return { state: "ok", dataClass: "workspace", content: await adapters.gitRevision(_binding, ref) };
    },
  };
}
