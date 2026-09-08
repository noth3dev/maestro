import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import type { GitPort } from "@maestro/domain";
import type { IpPythonHostBinding } from "./ipython-host.js";

export interface IpPythonGitRevisionAdapterOptions {
  /** An already-authorized GitPort; this adapter never starts Git itself. */
  readonly git: Pick<GitPort, "headRevision">;
  /** Repository target selected by Control Plane composition, never by Python input. */
  readonly repositoryPath: string;
}

function canonicalPath(inputPath: string): string {
  let candidate = resolve(inputPath);
  const missingSegments: string[] = [];
  for (;;) {
    try {
      const existing = realpathSync.native(candidate);
      return missingSegments.length === 0 ? existing : resolve(existing, ...missingSegments);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw new Error("path cannot be resolved");
      missingSegments.unshift(basename(candidate));
      candidate = parent;
    }
  }
}

function isWithinScope(targetPath: string, scopes: readonly string[]): boolean {
  let target: string;
  try { target = canonicalPath(targetPath); } catch { return false; }
  return scopes.some((scope) => {
    try {
      const remainder = relative(canonicalPath(scope), target);
      return remainder === "" || (!remainder.startsWith("..") && !isAbsolute(remainder));
    } catch { return false; }
  });
}

/**
 * Bind read-only Git revision evidence to one immutable repository target.
 * The returned function is intended for `createIpPythonReadOnlyGateway`; the
 * host request handler remains responsible for method/payload validation.
 */
export function createIpPythonGitRevisionAdapter(options: IpPythonGitRevisionAdapterOptions): (binding: IpPythonHostBinding, ref: string) => Promise<string> {
  if (typeof options.repositoryPath !== "string" || options.repositoryPath.trim() === "") throw new Error("IPython Git repository path is required");
  if (typeof options.git.headRevision !== "function") throw new Error("IPython Git revision port is required");
  return async (binding, ref) => {
    if (!isWithinScope(options.repositoryPath, binding.pathScope)) throw new Error("IPython Git repository is outside the Goal scope");
    if (typeof ref !== "string" || ref.trim() === "" || ref.includes("\0") || /\s/.test(ref)) throw new Error("IPython Git ref is invalid");
    return options.git.headRevision(options.repositoryPath, ref);
  };
}
