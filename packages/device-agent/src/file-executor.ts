import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export interface DeviceFileExecutionResult { readonly resultSummary: string; }
export interface DeviceFileExecutor { execute(action: string, target: string): Promise<DeviceFileExecutionResult>; }
export class DeviceFileScopeError extends Error {}

export function createBoundedProjectFileReader(projectRoot: string, maxBytes = 64 * 1024): DeviceFileExecutor {
  if (!isAbsolute(projectRoot) || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new DeviceFileScopeError("Invalid device project-root configuration");
  return {
    async execute(action, target) {
      if (action !== "project.file.read") throw new DeviceFileScopeError("Only project.file.read is implemented in this slice");
      if (!isAbsolute(target)) throw new DeviceFileScopeError("Device file target must be absolute");
      const root = await realpath(projectRoot);
      const candidate = await realpath(resolve(target));
      const relativeTarget = relative(root, candidate);
      if (relativeTarget === "" || relativeTarget.startsWith("..") || isAbsolute(relativeTarget)) throw new DeviceFileScopeError("Device file target escapes project root");
      // Re-open the final path without following a final symlink, then stat
      // and read through the same descriptor. This closes the common
      // realpath/stat/read swap window while retaining the root containment
      // check above.
      const handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const metadata = await handle.stat();
        if (!metadata.isFile() || metadata.size > maxBytes) throw new DeviceFileScopeError("Device file is not a bounded regular file");
        const content = await handle.readFile();
        if (content.byteLength > maxBytes) throw new DeviceFileScopeError("Device file exceeded the byte ceiling");
        return { resultSummary: `read ${content.byteLength} bytes from project file` };
      } finally { await handle.close(); }
    },
  };
}
