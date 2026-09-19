import { matchesKey, type AutocompleteItem } from "@earendil-works/pi-tui";
import { createCommandRegistry } from "./registry.js";

const RAW_KEYBOARD_SHORTCUTS: readonly AutocompleteItem[] = [
  { value: "Ctrl+G", label: "Ctrl+G", description: "list Goals" },
  { value: "Ctrl+E", label: "Ctrl+E", description: "list events" },
  { value: "Ctrl+R", label: "Ctrl+R", description: "retry the session" },
  { value: "Ctrl+A", label: "Ctrl+A", description: "review pending decisions" },
  { value: "Ctrl+/", label: "Ctrl+/", description: "restore the home splash" },
];

export function createCommandPalette(): AutocompleteItem[] {
  const commands = createCommandRegistry()
    .all()
    .flatMap((command) => {
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

function renderCommandPalette(items: readonly AutocompleteItem[]): string {
  const groups: Record<string, AutocompleteItem[]> = {
    READ: [],
    WRITE: [],
    CRITICAL: [],
    SHORTCUTS: [],
    OTHER: [],
  };
  for (const item of items) {
    const description = item.description ?? "other";
    const group = item.value.startsWith("Ctrl+") ? "SHORTCUTS" : description.toUpperCase();
    const bucket = groups[group] ?? groups.OTHER;
    if (bucket === undefined) continue;
    bucket.push(item);
  }

  const lines = ["Commands:"];
  for (const group of ["READ", "WRITE", "CRITICAL", "SHORTCUTS"]) {
    const entries = groups[group] ?? [];
    if (entries.length === 0) continue;
    lines.push(`${group}:`);
    for (const item of entries) lines.push(`  ${item.label} [${item.description ?? "other"}]`);
  }
  const otherEntries = groups.OTHER ?? [];
  if (otherEntries.length > 0) lines.push(`OTHER: ${otherEntries.map((item) => item.label).join(" · ")}`);
  lines.push("At a glance:");
  for (const group of ["READ", "WRITE", "CRITICAL"]) {
    const representative = groups[group]?.[0];
    if (representative !== undefined) lines.push(`  ${group}: ${representative.label}`);
  }
  lines.push("Groups: READ · WRITE · CRITICAL · SHORTCUTS · OTHER", "Catalog above · PgUp/PgDn scroll");
  return lines.join("\n");
}

export function dispatchCommandPaletteInput(input: string, write: (text: string) => void): boolean {
  if (input !== "help" && !matchesKey(input, "ctrl+k")) return false;
  write(renderCommandPalette(createCommandPalette()));
  return true;
}
