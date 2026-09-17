import type { AutocompleteItem, AutocompleteProvider, SlashCommand } from "@earendil-works/pi-tui";
import type { CommandRegistry } from "./registry.js";

function slashArgumentText(lines: string[], cursorLine: number, cursorCol: number): string | undefined {
  if (cursorLine !== 0) return undefined;
  const textBeforeCursor = lines[cursorLine]?.slice(0, cursorCol) ?? "";
  return textBeforeCursor.startsWith("/") && textBeforeCursor.includes(" ") ? textBeforeCursor : undefined;
}

function looksLikeFileValue(textBeforeCursor: string): boolean {
  const lastSpace = Math.max(textBeforeCursor.lastIndexOf(" "), textBeforeCursor.lastIndexOf("\t"));
  const currentToken = textBeforeCursor.slice(lastSpace + 1);
  return currentToken.includes("/") || currentToken.startsWith(".") || currentToken.startsWith("~");
}

/**
 * Keep explicit Tab in slash-command argument contexts on command completion.
 * pi-tui uses force=true for Tab after a space, which otherwise bypasses its
 * slash-command branch and invokes generic file completion instead.
 */
export function createSlashCommandAutocompleteProvider(provider: AutocompleteProvider): AutocompleteProvider {
  const wrapped: AutocompleteProvider = {
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      const textBeforeCursor = slashArgumentText(lines, cursorLine, cursorCol);
      if (options.force !== true || textBeforeCursor === undefined) return provider.getSuggestions(lines, cursorLine, cursorCol, options);

      const commandSuggestions = await provider.getSuggestions(lines, cursorLine, cursorCol, { ...options, force: false });
      if (commandSuggestions?.items.length || !looksLikeFileValue(textBeforeCursor)) return commandSuggestions;
      return provider.getSuggestions(lines, cursorLine, cursorCol, options);
    },
    applyCompletion: (...args) => provider.applyCompletion(...args),
  };
  if (provider.triggerCharacters !== undefined) wrapped.triggerCharacters = [...provider.triggerCharacters];
  if (provider.shouldTriggerFileCompletion !== undefined) {
    wrapped.shouldTriggerFileCompletion = (...args) => provider.shouldTriggerFileCompletion!(...args);
  }
  return wrapped;
}

export function createCommandAutocompleteItems(registry: CommandRegistry): SlashCommand[] {
  const commands = registry.all().map((command) => ({
    name: command.name,
    description: command.description,
    getArgumentCompletions(argumentPrefix: string): AutocompleteItem[] {
      const prefix = argumentPrefix.trimStart();
      const [action = "", ...rest] = prefix.split(/\s+/);
      if (rest.length === 0 && !prefix.includes("--")) return command.actions
        .filter((candidate) => candidate.name.startsWith(action.toLowerCase()))
        .map((candidate) => ({ value: `${candidate.name} `, label: candidate.name, description: candidate.description }));
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
  const withModelAlias = models === undefined || commands.some((command) => command.name === "model")
    ? commands
    : [...commands, { ...models, name: "model" }];

  // `/new` and `/retry` are parser aliases for session actions, not registry commands.
  const session = commands.find((command) => command.name === "session");
  const sessionAliases = session === undefined
    ? []
    : ([
      ["new", "start a new workspace session"],
      ["retry", "retry the saved workspace session"],
    ] as const)
      .filter(([name]) => !commands.some((command) => command.name === name))
      .map(([name, description]) => ({ name, description, getArgumentCompletions: () => [] }));

  return [...withModelAlias, ...sessionAliases];
}
