import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { ActionRequest, AuthorityDecision } from "@maestro/authority";

export interface ReadOnlyFileAuthorityGateway {
  execute(request: ActionRequest, effect: () => Promise<unknown>): Promise<AuthorityDecision>;
}

export type ReadOnlyFileAuthorityContext = Omit<ActionRequest, "action" | "target">;

export interface ReadOnlyFilePort {
  readFile(relativePath: string): Promise<string>;
}

export interface ReadOnlyFileAdapterOptions {
  readonly authority: ReadOnlyFileAuthorityGateway;
  readonly context: ReadOnlyFileAuthorityContext;
  readonly workspaceRoot: string;
  readonly maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 64_000;
const SENSITIVE_PATH = /(?:^|[\\/])(?:\.git(?:[\\/].*)?|\.env(?:\..*)?|id_rsa(?:\..*)?|.*(?:password|passwd|secret|token|private[-_]?key|api[-_]?key).*[.]?(?:pem|key|json|txt)?|.*\.(?:pem|key))$/i;

export class ReadOnlyFileBoundaryError extends Error {}

export class ReadOnlyFileAuthorizationError extends ReadOnlyFileBoundaryError {
  readonly decision: AuthorityDecision;
  constructor(decision: AuthorityDecision) {
    super(`Project file read was not authorized: ${decision.reason}`);
    this.name = "ReadOnlyFileAuthorizationError";
    this.decision = decision;
  }
}

function boundedInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function safeExistingPath(candidate: string): string {
  try { return realpathSync(candidate); } catch { return resolve(candidate); }
}

function resolveReadPath(root: string, relativePath: string): string {
  if (typeof relativePath !== "string" || relativePath.trim() === "" || relativePath.includes("\0") || relativePath.includes("\\") || relativePath.startsWith("/") || /^[A-Za-z]:/.test(relativePath) || relativePath.split("/").some((part) => part === "..")) throw new ReadOnlyFileBoundaryError("Project file path is outside the workspace");
  const workspace = safeExistingPath(root);
  const candidate = safeExistingPath(resolve(workspace, relativePath));
  const remainder = relative(workspace, candidate);
  if (remainder === "" || remainder.startsWith("..") || remainder.includes("/..")) throw new ReadOnlyFileBoundaryError("Project file path is outside the workspace");
  if (SENSITIVE_PATH.test(relativePath)) throw new ReadOnlyFileBoundaryError("sensitive project file reads are not allowed");
  return candidate;
}

export function createAuthorizedReadOnlyFilePort(options: ReadOnlyFileAdapterOptions): ReadOnlyFilePort {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!boundedInteger(maxBytes)) throw new ReadOnlyFileBoundaryError("Read-only file output limit is invalid");
  return {
    async readFile(relativePath: string): Promise<string> {
      const targetPath = resolveReadPath(options.workspaceRoot, relativePath);
      let content = "";
      let invoked = false;
      const decision = await options.authority.execute(
        { ...options.context, action: "project.file.read", target: JSON.stringify([targetPath]) },
        async () => {
          invoked = true;
          const bytes = await readFile(targetPath);
          if (bytes.byteLength > maxBytes) throw new ReadOnlyFileBoundaryError("Project file output limit exceeded");
          content = bytes.toString("utf8");
        },
      );
      if (decision.effect !== "allow") throw new ReadOnlyFileAuthorizationError(decision);
      if (!invoked) throw new ReadOnlyFileBoundaryError("File authority allowed without invoking the effect");
      return content;
    },
  };
}
