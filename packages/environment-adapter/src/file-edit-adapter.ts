import { constants, realpathSync } from "node:fs";
import { open } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import type { ActionRequest, AuthorityDecision } from "@maestro/authority";

export interface FileEditAuthorityGateway {
  execute(request: ActionRequest, effect: () => Promise<unknown>): Promise<AuthorityDecision>;
}

export type FileEditAuthorityContext = Omit<ActionRequest, "action" | "target">;

export interface FileEditAdapterOptions {
  readonly authority: FileEditAuthorityGateway;
  readonly context: FileEditAuthorityContext;
  readonly workspaceRoot: string;
  readonly pathScope?: readonly string[];
  readonly maxBytes?: number;
}

export interface FileEditPort {
  writeFile(relativePath: string, content: string): Promise<void>;
}

export class FileEditBoundaryError extends Error {
  constructor(message: string) { super(message); this.name = "FileEditBoundaryError"; }
}

export class FileEditAuthorizationError extends FileEditBoundaryError {
  readonly decision: AuthorityDecision;
  constructor(decision: AuthorityDecision) {
    super(`Project file edit was not authorized: ${decision.reason}`);
    this.name = "FileEditAuthorizationError";
    this.decision = decision;
  }
}

export class FileEditOutcomeUnknownError extends FileEditBoundaryError {
  constructor(readonly decision?: AuthorityDecision) { super("Project file edit outcome is unknown"); this.name = "FileEditOutcomeUnknownError"; }
}

const DEFAULT_MAX_BYTES = 1_048_576;
const SENSITIVE_PATH = /(?:^|[/])(?:\.git(?:[/].*)?|\.env(?:\..*)?|id_rsa(?:\..*)?|.*(?:password|passwd|secret|token|private[-_]?key|api[-_]?key).*[.]?(?:pem|key|json|txt)?|.*\.(?:pem|key))$/i;

function existingPath(path: string): string {
  try { return realpathSync.native(path); } catch { return resolve(path); }
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

async function openCanonicalParent(workspaceRoot: string, targetPath: string): Promise<{ directory: Awaited<ReturnType<typeof open>>; name: string }> {
  const workspace = existingPath(workspaceRoot);
  const relativeTarget = relative(workspace, targetPath);
  if (relativeTarget === "" || relativeTarget.startsWith(`..${sep}`) || relativeTarget === ".." || relativeTarget.includes(`..${sep}`)) throw new FileEditBoundaryError("Project file edit path is outside the workspace");
  let directory = await open(workspace, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const parentParts = dirname(relativeTarget).split(sep).filter((part) => part !== "" && part !== ".");
    for (const part of parentParts) {
      const next = await open(`/proc/self/fd/${directory.fd}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      await directory.close();
      directory = next;
    }
    return { directory, name: basename(targetPath) };
  } catch (error) {
    await directory.close();
    throw new FileEditBoundaryError(`Project file edit parent changed during authorization: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function resolveWritePath(workspaceRoot: string, relativePath: string, pathScope?: readonly string[]): string {
  if (typeof relativePath !== "string" || relativePath.trim() === "" || relativePath.includes("\0") || relativePath.includes("\\") || relativePath.startsWith("/") || /^[A-Za-z]:/.test(relativePath) || relativePath.split("/").some((part) => part === "..")) {
    throw new FileEditBoundaryError("Project file edit path is outside the workspace");
  }
  const workspace = existingPath(workspaceRoot);
  const lexical = resolve(workspace, relativePath);
  let target: string;
  try {
    target = realpathSync.native(lexical);
  } catch {
    const parent = dirname(lexical);
    try { target = resolve(realpathSync.native(parent), basename(lexical)); }
    catch { throw new FileEditBoundaryError("Project file edit parent is unavailable"); }
  }
  const within = (root: string, candidate: string): boolean => {
    const remainder = relative(root, candidate);
    return remainder !== "" && !remainder.startsWith("..") && !remainder.includes("/..") && !remainder.includes("\\");
  };
  if (!within(workspace, target)) throw new FileEditBoundaryError("Project file edit path is outside the workspace");
  if (pathScope !== undefined && !pathScope.some((scope) => {
    if (typeof scope !== "string" || scope.trim() === "") return false;
    const scopedRoot = existingPath(resolve(workspace, scope));
    return within(scopedRoot, target);
  })) throw new FileEditBoundaryError("Project file edit path is outside the Goal scope");
  if (SENSITIVE_PATH.test(relativePath) || SENSITIVE_PATH.test(target)) throw new FileEditBoundaryError("sensitive project file edits are not allowed");
  return target;
}

export function createAuthorizedFileEditPort(options: FileEditAdapterOptions): FileEditPort {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!positiveSafeInteger(maxBytes)) throw new FileEditBoundaryError("File edit output limit is invalid");
  if (typeof options.workspaceRoot !== "string" || options.workspaceRoot.trim() === "") throw new FileEditBoundaryError("File edit workspace root is required");
  return {
    async writeFile(relativePath, content) {
      if (typeof content !== "string") throw new FileEditBoundaryError("File edit content must be text");
      if (Buffer.byteLength(content, "utf8") > maxBytes) throw new FileEditBoundaryError("File edit content exceeds the output limit");
      const targetPath = resolveWritePath(options.workspaceRoot, relativePath, options.pathScope);
      let invoked = false;
      let decision: AuthorityDecision;
      try {
        decision = await options.authority.execute(
          { ...options.context, action: "project.file.edit", target: JSON.stringify([targetPath]) },
          async () => {
            invoked = true;
            const parent = await openCanonicalParent(options.workspaceRoot, targetPath);
            try {
              const handle = await open(`/proc/self/fd/${parent.directory.fd}/${parent.name}`, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
              try {
                let openedPath: string;
                try { openedPath = realpathSync.native(`/proc/self/fd/${handle.fd}`); }
                catch { throw new FileEditBoundaryError("Project file edit descriptor identity is unavailable"); }
                if (openedPath !== targetPath) throw new FileEditBoundaryError("Project file changed during authorization");
                await handle.writeFile(content, "utf8");
              } finally { await handle.close(); }
            } finally { await parent.directory.close(); }
          },
        );
      } catch (error) {
        if (invoked) throw new FileEditOutcomeUnknownError();
        throw error;
      }
      if (decision.effect !== "allow") throw new FileEditAuthorizationError(decision);
      if (decision.reason === "already_executed") throw new FileEditOutcomeUnknownError(decision);
      if (!invoked) throw new FileEditBoundaryError("File authority allowed without invoking the effect");
    },
  };
}
