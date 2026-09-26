import { execFile } from "node:child_process";
import { lstat, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { assertWorkspacePath } from "@maestro/git-adapter";
import { UuidSchema } from "@maestro/contracts";

const execFileAsync = promisify(execFile);
const GIT = "/usr/bin/git";
const MAX_FILE_BYTES = 1_048_576;
const MAX_IMAGE_BYTES = 8 * 1_048_576;
const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp)$/i;
const MAX_FILES = 2_000;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/;

export class SessionWorkspacePathError extends Error {}
export class SessionWorkspaceFileNotFoundError extends Error {}

export interface SessionWorkspaceFileEntry {
  readonly path: string;
  readonly size: number;
}

export interface SessionWorkspace {
  list(projectId: string, conversationId: string): Promise<{ files: SessionWorkspaceFileEntry[]; revision: string | null }>;
  /** Text files come back as UTF-8; images as base64 with `encoding: "base64"`. */
  read(projectId: string, conversationId: string, path: string): Promise<{ path: string; content: string; revision: string | null; encoding?: "base64" }>;
  /** Write whole files and record them as one commit; returns the new (or unchanged) revision. */
  write(
    projectId: string,
    conversationId: string,
    files: readonly { path: string; content: string }[],
    message: string,
  ): Promise<{ revision: string | null }>;
}

/** Validate a workspace-relative file path: plain segments only, no traversal, no hidden or Git metadata. */
export function normalizeWorkspaceFilePath(path: string): string {
  if (typeof path !== "string" || path.length === 0 || path.length > 256 || path.includes("\0") || path.includes("\\"))
    throw new SessionWorkspacePathError("Workspace file path is invalid");
  const segments = path.split("/");
  if (segments.some((segment) => !SEGMENT.test(segment) || segment === "." || segment === ".."))
    throw new SessionWorkspacePathError("Workspace file path is invalid");
  return posix.normalize(path);
}

/**
 * Per-session Git workspaces under `<root>/sessions/<projectId>/<conversationId>`.
 * Each write is a commit, so the revision identifies an exact file set.
 */
export function createSessionWorkspace(options: { root: string }): SessionWorkspace {
  const directory = (projectId: string, conversationId: string) =>
    join(options.root, "sessions", UuidSchema.parse(projectId), UuidSchema.parse(conversationId));

  const contained = (root: string, relativePath: string) => assertWorkspacePath(join(root, relativePath), "Workspace file", options.root);

  const git = async (cwd: string, args: readonly string[]) =>
    (
      await execFileAsync(GIT, ["-c", "user.name=Maestro", "-c", "user.email=maestro@localhost", "-c", "commit.gpgsign=false", ...args], {
        cwd,
        timeout: 30_000,
        maxBuffer: MAX_FILE_BYTES,
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/tmp", GIT_TERMINAL_PROMPT: "0" },
      })
    ).stdout.trim();

  const revision = async (root: string): Promise<string | null> => {
    try {
      return await git(root, ["rev-parse", "--verify", "HEAD"]);
    } catch {
      return null;
    }
  };

  const exists = async (path: string) => {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  };

  return {
    async list(projectId, conversationId) {
      const root = directory(projectId, conversationId);
      if (!(await exists(root))) return { files: [], revision: null };
      const files: SessionWorkspaceFileEntry[] = [];
      const walk = async (relative: string): Promise<void> => {
        const entries = await readdir(join(root, relative), { withFileTypes: true });
        for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
          if (files.length >= MAX_FILES) return;
          if (!SEGMENT.test(entry.name)) continue;
          const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
          if (entry.isDirectory()) await walk(child);
          else if (entry.isFile()) files.push({ path: child, size: (await lstat(join(root, child))).size });
        }
      };
      await walk("");
      return { files, revision: await revision(root) };
    },

    async read(projectId, conversationId, path) {
      const root = directory(projectId, conversationId);
      const relative = normalizeWorkspaceFilePath(path);
      const absolute = contained(root, relative);
      let info;
      try {
        info = await lstat(absolute);
      } catch {
        throw new SessionWorkspaceFileNotFoundError("Workspace file not found");
      }
      if (!info.isFile()) throw new SessionWorkspaceFileNotFoundError("Workspace file not found");
      const image = IMAGE_EXTENSION.test(relative);
      if (info.size > (image ? MAX_IMAGE_BYTES : MAX_FILE_BYTES)) throw new SessionWorkspacePathError("Workspace file is too large to display");
      const bytes = await readFile(absolute);
      if (image) return { path: relative, content: bytes.toString("base64"), revision: await revision(root), encoding: "base64" };
      let content: string;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new SessionWorkspacePathError("Workspace file is not UTF-8 text");
      }
      return { path: relative, content, revision: await revision(root) };
    },

    async write(projectId, conversationId, files, message) {
      if (files.length === 0) throw new SessionWorkspacePathError("No workspace files to write");
      const root = directory(projectId, conversationId);
      await mkdir(root, { recursive: true });
      assertWorkspacePath(root, "Session workspace", options.root);
      if (!(await exists(join(root, ".git")))) await git(root, ["init", "-q", "-b", "main"]);
      for (const file of files) {
        const relative = normalizeWorkspaceFilePath(file.path);
        if (Buffer.byteLength(file.content, "utf8") > MAX_FILE_BYTES) throw new SessionWorkspacePathError(`${relative} is too large`);
        const absolute = contained(root, relative);
        await mkdir(dirname(absolute), { recursive: true });
        contained(root, relative);
        const temporary = `${absolute}.${randomUUID()}.tmp`;
        await writeFile(temporary, file.content, { encoding: "utf8", mode: 0o600 });
        await rename(temporary, absolute);
      }
      await git(root, ["add", "--all"]);
      const status = await git(root, ["status", "--porcelain"]);
      if (status !== "") await git(root, ["commit", "-q", "--no-verify", "-m", message.slice(0, 200) || "Update workspace"]);
      return { revision: await revision(root) };
    },
  };
}
