import type { AutocompleteItem, AutocompleteProvider, SlashCommand } from "@earendil-works/pi-tui";
import type { CommandRegistry } from "./registry.js";

function normalizeSlashSeparators(text: string): string {
  let quote: "\"" | "'" | undefined;
  let escaped = false;
  return [...text].map((character) => {
    if (escaped) {
      escaped = false;
      return character;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      return character;
    }
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      return character;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      return character;
    }
    return character === "\t" ? " " : character;
  }).join("");
}

function normalizeSlashContext(
  lines: string[],
  cursorLine: number,
  cursorCol: number,
): { lines: string[]; cursorLine: number; cursorCol: number } | undefined {
  if (cursorLine !== 0 || lines.length !== 1) return undefined;
  const line = lines[cursorLine] ?? "";
  const textBeforeCursor = line.slice(0, cursorCol);
  const trimmedText = textBeforeCursor.trimStart();
  if (!trimmedText.startsWith("/")) return undefined;
  const leadingOffset = textBeforeCursor.length - trimmedText.length;
  const normalizedLine = normalizeSlashSeparators(line.slice(leadingOffset));
  if (leadingOffset === 0 && normalizedLine === line) return { lines, cursorLine, cursorCol };
  const normalizedLines = [...lines];
  normalizedLines[cursorLine] = normalizedLine;
  return { lines: normalizedLines, cursorLine, cursorCol: cursorCol - leadingOffset };
}

function slashArgumentText(lines: string[], cursorLine: number, cursorCol: number): string | undefined {
  if (cursorLine !== 0) return undefined;
  const textBeforeCursor = lines[cursorLine]?.slice(0, cursorCol) ?? "";
  const trimmedText = textBeforeCursor.trimStart();
  return trimmedText.startsWith("/") && /[ \t]/.test(trimmedText) ? textBeforeCursor : undefined;
}

function slashOptionPrefix(
  lines: string[],
  cursorLine: number,
  cursorCol: number,
  item: AutocompleteItem,
  prefix: string,
): string | undefined {
  if (lines.length !== 1 || cursorLine !== 0 || !item.value.startsWith("--")) return undefined;
  const textBeforeCursor = lines[cursorLine]?.slice(0, cursorCol) ?? "";
  const trimmedText = textBeforeCursor.trimStart();
  if (!trimmedText.startsWith("/") || !/[ \t]/.test(trimmedText)) return undefined;
  const lastSpace = Math.max(textBeforeCursor.lastIndexOf(" "), textBeforeCursor.lastIndexOf("\t"));
  const currentToken = textBeforeCursor.slice(lastSpace + 1);
  return currentToken.startsWith("--") && prefix.endsWith(currentToken) ? currentToken : undefined;
}

function scanAutocompleteArgumentTokens(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "\"" | "'" | undefined;
  let escaped = false;
  let tokenStarted = false;
  for (const character of text) {
    if (escaped) {
      current += character;
      escaped = false;
      tokenStarted = true;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      current += character;
      escaped = true;
      tokenStarted = true;
      continue;
    }
    if (quote !== undefined) {
      current += character;
      tokenStarted = true;
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === "\"" || character === "'") {
      current += character;
      quote = character;
      tokenStarted = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (tokenStarted) {
        tokens.push(current);
        current = "";
        tokenStarted = false;
      }
      continue;
    }
    current += character;
    tokenStarted = true;
  }
  if (tokenStarted || /\s$/.test(text)) tokens.push(current);
  return tokens;
}

function isPathShapedValue(value: string): boolean {
  return value.includes("/") || value.includes("\\") || value.startsWith(".") || value === "~" || value.startsWith("~/");
}

function activeQuotedValue(textBeforeCursor: string): string | undefined {
  let quoteStart = -1;
  let escaped = false;
  for (let index = 0; index < textBeforeCursor.length; index += 1) {
    const character = textBeforeCursor[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character !== '"') continue;
    quoteStart = quoteStart === -1 ? index : -1;
  }
  if (quoteStart === -1) return undefined;
  const opener = textBeforeCursor[quoteStart - 1];
  if (quoteStart > 0 && opener !== " " && opener !== "\t" && opener !== "=") return undefined;
  return textBeforeCursor.slice(quoteStart + 1);
}

function activeSingleQuotedValue(textBeforeCursor: string): { start: number; value: string; isAttachment: boolean } | undefined {
  let quoteStart = -1;
  let quote: "\"" | "'" | undefined;
  let escaped = false;
  for (let index = 0; index < textBeforeCursor.length; index += 1) {
    const character = textBeforeCursor[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      quoteStart = index;
    }
  }
  if (quote !== "'" || quoteStart === -1) return undefined;
  const opener = textBeforeCursor[quoteStart - 1];
  const isAttachment = opener === "@"
    && (quoteStart === 1 || textBeforeCursor[quoteStart - 2] === " " || textBeforeCursor[quoteStart - 2] === "\t" || textBeforeCursor[quoteStart - 2] === "=");
  if (!isAttachment && quoteStart > 0 && opener !== " " && opener !== "\t" && opener !== "=") return undefined;
  return { start: quoteStart, value: textBeforeCursor.slice(quoteStart + 1), isAttachment };
}

function replaceCharacter(text: string, index: number, replacement: string): string {
  return `${text.slice(0, index)}${replacement}${text.slice(index + 1)}`;
}

function mapDoubleQuotedValueToSingle(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? `'${value.slice(1, -1)}'` : value;
}

function mapDoubleQuotedPrefixToSingle(prefix: string): string {
  return prefix.startsWith('"') ? `'${prefix.slice(1)}` : prefix;
}

function mapSingleQuotedSuggestions(suggestions: Awaited<ReturnType<AutocompleteProvider["getSuggestions"]>>): Awaited<ReturnType<AutocompleteProvider["getSuggestions"]>> {
  if (suggestions === null) return null;
  return {
    ...suggestions,
    prefix: mapDoubleQuotedPrefixToSingle(suggestions.prefix),
    items: suggestions.items.map((item) => ({ ...item, value: mapDoubleQuotedValueToSingle(item.value) })),
  };
}

function looksLikeFileValue(textBeforeCursor: string): boolean {
  const quotedValue = activeQuotedValue(textBeforeCursor);
  if (quotedValue !== undefined) return isPathShapedValue(quotedValue);
  const lastSpace = Math.max(textBeforeCursor.lastIndexOf(" "), textBeforeCursor.lastIndexOf("\t"));
  return isPathShapedValue(textBeforeCursor.slice(lastSpace + 1));
}

/**
 * Keep explicit Tab in slash-command argument contexts on command completion.
 * pi-tui uses force=true for Tab after a space, which otherwise bypasses its
 * slash-command branch and invokes generic file completion instead.
 */
export function createSlashCommandAutocompleteProvider(provider: AutocompleteProvider): AutocompleteProvider {
  const wrapped: AutocompleteProvider = {
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      const normalizedSlash = normalizeSlashContext(lines, cursorLine, cursorCol);
      if (normalizedSlash === undefined) return provider.getSuggestions(lines, cursorLine, cursorCol, options);

      const textBeforeCursor = slashArgumentText(lines, cursorLine, cursorCol);
      if (options.force !== true || textBeforeCursor === undefined) {
        return provider.getSuggestions(normalizedSlash.lines, normalizedSlash.cursorLine, normalizedSlash.cursorCol, options);
      }

      const commandSuggestions = await provider.getSuggestions(
        normalizedSlash.lines,
        normalizedSlash.cursorLine,
        normalizedSlash.cursorCol,
        { ...options, force: false },
      );
      if (commandSuggestions?.items.length) return commandSuggestions;

      const normalizedTextBeforeCursor = normalizedSlash.lines[normalizedSlash.cursorLine]!.slice(0, normalizedSlash.cursorCol);
      const singleQuote = activeSingleQuotedValue(normalizedTextBeforeCursor);
      if (singleQuote?.isAttachment) return commandSuggestions;
      if (singleQuote !== undefined
        && normalizedSlash.lines[normalizedSlash.cursorLine]!.slice(singleQuote.start + 1).includes('"')) return commandSuggestions;
      if (singleQuote !== undefined
        && !normalizedTextBeforeCursor.slice(singleQuote.start + 1).includes('"')
        && !normalizedSlash.lines[normalizedSlash.cursorLine]!.slice(singleQuote.start + 1).includes('"')
        && isPathShapedValue(singleQuote.value)) {
        const syntheticLines = [...normalizedSlash.lines];
        syntheticLines[normalizedSlash.cursorLine] = replaceCharacter(syntheticLines[normalizedSlash.cursorLine]!, singleQuote.start, '"');
        const singleSuggestions = await provider.getSuggestions(
          syntheticLines,
          normalizedSlash.cursorLine,
          normalizedSlash.cursorCol,
          options,
        );
        return mapSingleQuotedSuggestions(singleSuggestions);
      }

      if (!looksLikeFileValue(textBeforeCursor)) return commandSuggestions;
      return provider.getSuggestions(normalizedSlash.lines, normalizedSlash.cursorLine, normalizedSlash.cursorCol, options);
    },
    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      const textBeforeCursor = lines[cursorLine]?.slice(0, cursorCol) ?? "";
      const singleQuote = activeSingleQuotedValue(textBeforeCursor);
      if (lines.length === 1
        && slashArgumentText(lines, cursorLine, cursorCol) !== undefined
        && singleQuote !== undefined
        && !singleQuote.isAttachment
        && isPathShapedValue(singleQuote.value)
        && prefix.startsWith("'")
        && textBeforeCursor.slice(singleQuote.start).startsWith(prefix)
        && !lines[cursorLine]!.slice(singleQuote.start + 1).includes('"')
        && item.value.startsWith("'")
        && item.value.endsWith("'")) {
        const syntheticLines = [...lines];
        const syntheticLine = replaceCharacter(syntheticLines[cursorLine]!, singleQuote.start, '"');
        syntheticLines[cursorLine] = syntheticLine[cursorCol] === "'"
          ? replaceCharacter(syntheticLine, cursorCol, '"')
          : syntheticLine;
        const syntheticItem = { ...item, value: `"${item.value.slice(1, -1)}"` };
        const syntheticResult = provider.applyCompletion(
          syntheticLines,
          cursorLine,
          cursorCol,
          syntheticItem,
          `"${prefix.slice(1)}`,
        );
        const mappedLines = [...syntheticResult.lines];
        const mappedLine = mappedLines[cursorLine]!;
        const closingQuoteIndex = item.label.endsWith("/") ? syntheticResult.cursorCol : syntheticResult.cursorCol - 1;
        let mappedResultLine = replaceCharacter(mappedLine, singleQuote.start, "'");
        if (mappedResultLine[closingQuoteIndex] === '"') mappedResultLine = replaceCharacter(mappedResultLine, closingQuoteIndex, "'");
        mappedLines[cursorLine] = mappedResultLine;
        return { ...syntheticResult, lines: mappedLines };
      }

      const optionPrefix = slashOptionPrefix(lines, cursorLine, cursorCol, item, prefix);
      return provider.applyCompletion(lines, cursorLine, cursorCol, item, optionPrefix ?? prefix);
    },
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
      const [action = "", ...rest] = scanAutocompleteArgumentTokens(prefix);
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
