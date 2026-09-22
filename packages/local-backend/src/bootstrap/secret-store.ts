import { Entry } from "@napi-rs/keyring";
import type { LocalSecretStore } from "./types.js";

export function createLocalSecretStore(): LocalSecretStore {
  const entry = new Entry("maestro", "local-control-plane");
  return {
    read: () => {
      try {
        const value = entry.getPassword();
        return value === null || value.trim() === "" ? undefined : value;
      } catch {
        return undefined;
      }
    },
    write: (value) => entry.setPassword(value),
    clear: () => {
      try { entry.deletePassword(); } catch { /* Missing keychain entries are already clear. */ }
    },
  };
}
