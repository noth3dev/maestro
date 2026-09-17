import type { AutocompleteItem, SlashCommand } from "@earendil-works/pi-tui";
import type { CommandRegistry } from "./registry.js";



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
      const actionDefinition = command.actions.find((candidate) => candidate.name === action.toLowerCase());
      const actionOptions = actionDefinition?.options ?? [];
      const optionPrefix = rest.at(-1) ?? "";
      const completedOptions = new Set(
        rest.slice(0, -1).filter((token) => token.startsWith("--")).map((token) => {
          const separator = token.indexOf("=");
          return separator === -1 ? token : token.slice(0, separator);
        }),
      );
      return actionOptions
        .filter((option) => !completedOptions.has(option) && option.startsWith(optionPrefix))
        .map((option) => ({ value: `${option} `, label: option, description: "option" }));
    },
  }));
  const models = commands.find((command) => command.name === "models");
  return models === undefined || commands.some((command) => command.name === "model") ? commands : [...commands, { ...models, name: "model" }];
}
