import type { AutocompleteItem, SlashCommand } from "@earendil-works/pi-tui";
import type { CommandRegistry } from "./registry.js";

const options: Record<string, readonly string[]> = {
  "admin project-access": ["--operator-id", "--project-id", "--roles-json"],
  "goal create": ["--project-id", "--contract-id", "--command-id"],
  "goal get": ["--goal-id", "--project-id"],
  "goal select": ["--goal-id"],
  "goal transition": ["--goal-id", "--project-id", "--expected-version", "--to", "--command-id"],
  "goal pause": ["--goal-id", "--project-id", "--reason", "--command-id"],
  "goal resume": ["--goal-id", "--project-id", "--reason", "--command-id"],
  "goal stop": ["--goal-id", "--project-id", "--reason", "--command-id"],
  "goal emergency-stop": ["--goal-id", "--project-id", "--reason", "--command-id"],
  "models use": ["--model"],
  "model use": ["--model"],
  "conversation create": ["--project-id", "--goal-id", "--model"],
  "conversation get": ["--conversation-id", "--project-id"],
  "conversation turn": ["--conversation-id", "--project-id", "--text"],
  "conversation cancel": ["--conversation-id", "--project-id"],
  "session attach": ["--project-id"],
};

export function createCommandAutocompleteItems(registry: CommandRegistry): SlashCommand[] {
  const commands = registry.all().map((command) => ({
    name: command.name,
    description: command.description,
    getArgumentCompletions(argumentPrefix: string): AutocompleteItem[] {
      const prefix = argumentPrefix.trimStart();
      const [action = "", ...rest] = prefix.split(/\s+/);
      if (rest.length === 0 && !prefix.includes("--")) return command.actions
        .filter((candidate) => candidate.name.startsWith(action.toLowerCase()))
        .map((candidate) => ({ value: candidate.name, label: candidate.name, description: candidate.description }));
      const actionOptions = options[`${command.name} ${action}`] ?? [];
      const optionPrefix = rest.at(-1) ?? "";
      return actionOptions
        .filter((option) => option.startsWith(optionPrefix))
        .map((option) => ({ value: `${option} `, label: option, description: "option" }));
    },
  }));
  const models = commands.find((command) => command.name === "models");
  return models === undefined ? commands : [...commands, { ...models, name: "model" }];
}
