import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { createCommandRegistry } from "./registry.js";

export function createCommandPalette(): AutocompleteItem[] {
  return createCommandRegistry().all().flatMap((command) => command.actions.map((action) => {
    const value = `/${command.name} ${action.name}`;
    return { value, label: value, description: action.kind };
  }));
}
