import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { createCommandRegistry } from "./registry.js";

const RAW_KEYBOARD_SHORTCUTS: readonly AutocompleteItem[] = [
  { value: "Ctrl+G", label: "Ctrl+G", description: "list Goals" },
  { value: "Ctrl+E", label: "Ctrl+E", description: "list events" },
  { value: "Ctrl+R", label: "Ctrl+R", description: "retry the session" },
  { value: "Ctrl+A", label: "Ctrl+A", description: "review pending decisions" },
  { value: "Ctrl+/", label: "Ctrl+/", description: "restore the home splash" },
];

export function createCommandPalette(): AutocompleteItem[] {
  const commands = createCommandRegistry().all().flatMap((command) => {
    if (command.actionless) {
      return [{ value: `/${command.name}`, label: `/${command.name}`, description: command.description }];
    }
    return command.actions.map((action) => {
      const value = `/${command.name} ${action.name}`;
      return { value, label: value, description: action.kind };
    });
  });
  return [...commands, ...RAW_KEYBOARD_SHORTCUTS];
}
