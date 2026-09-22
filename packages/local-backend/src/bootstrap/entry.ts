import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ConnectionEnvironment } from "../connection.js";

// Entry resolution is anchored at this package's src/ directory, not at this
// file: bootstrap/ lives one level deeper, so resolve one level up first to
// keep every ../../../ layout candidate identical to the pre-split behavior.
const srcDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function resolveModelGatewayEntry(env: ConnectionEnvironment, moduleDirectory = srcDirectory): string | undefined {
  const explicit = env.MAESTRO_MODEL_GATEWAY_ENTRY?.trim();
  if (explicit !== undefined && explicit !== "") return resolve(explicit);
  const cwdCandidate = resolve(process.cwd(), "apps", "model-gateway", "dist", "main.js");
  try { if (requireFile(cwdCandidate)) return cwdCandidate; } catch { /* Continue to the installed-layout candidate. */ }
  const installedCandidate = resolve(moduleDirectory, "../../../model-gateway/dist/main.js");
  try { if (requireFile(installedCandidate)) return installedCandidate; } catch { /* Continue to the packaged-layout candidate. */ }
  const packagedCandidate = resolvePackagedAppEntry(moduleDirectory, "model-gateway");
  try { if (requireFile(packagedCandidate)) return packagedCandidate; } catch { /* No local bundled model gateway. */ }
  return undefined;
}

export function resolveInstalledControlPlaneEntry(moduleDirectory = srcDirectory): string {
  return resolve(moduleDirectory, "../../../control-plane/dist/main.js");
}

/** App entry for the packages/<pkg>/dist layout (this module's own home). */
export function resolvePackagedAppEntry(moduleDirectory: string, app: "control-plane" | "model-gateway"): string {
  return resolve(moduleDirectory, `../../../apps/${app}/dist/main.js`);
}

export function resolveControlPlaneEntry(env: ConnectionEnvironment, moduleDirectory = srcDirectory): string | undefined {
  const explicit = env.MAESTRO_CONTROL_PLANE_ENTRY?.trim();
  if (explicit !== undefined && explicit !== "") return resolve(explicit);
  const cwdCandidate = resolve(process.cwd(), "apps", "control-plane", "dist", "main.js");
  try { if (requireFile(cwdCandidate)) return cwdCandidate; } catch { /* Continue to the installed-layout candidate. */ }
  const installedCandidate = resolveInstalledControlPlaneEntry(moduleDirectory);
  try { if (requireFile(installedCandidate)) return installedCandidate; } catch { /* Continue to the packaged-layout candidate. */ }
  const packagedCandidate = resolvePackagedAppEntry(moduleDirectory, "control-plane");
  try { if (requireFile(packagedCandidate)) return packagedCandidate; } catch { /* No local bundled Control Plane. */ }
  return undefined;
}

function requireFile(path: string): boolean {
  return existsSync(path);
}
