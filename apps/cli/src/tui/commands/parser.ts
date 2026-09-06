export interface ParsedCommand {
  kind: "command";
  name: string;
  action?: string;
  options: Record<string, string | boolean>;
}

export type ParsedInput = ParsedCommand | { kind: "natural-language"; text: string };

export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "\"" | "\'" | undefined;
  let escaped = false;
  for (const char of input) {
    if (escaped) { current += char; escaped = false; continue; }
    if (char === "\\" && quote !== "\'") { escaped = true; continue; }
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      else current += char;
      continue;
    }
    if (char === "\"" || char === "\'") { quote = char; continue; }
    if (/\s/.test(char)) {
      if (current !== "") { tokens.push(current); current = ""; }
    } else current += char;
  }
  if (escaped) current += "\\";
  if (quote !== undefined) throw new Error("Unterminated quote");
  if (current !== "") tokens.push(current);
  return tokens;
}

export function parseInput(input: string): ParsedInput {
  const text = input.trim();
  if (!text.startsWith("/")) return { kind: "natural-language", text: input };
  const tokens = tokenize(text.slice(1));
  const [name = "", action, ...rest] = tokens;
  if ((name === "new" || name === "retry") && action === undefined && rest.length === 0) return { kind: "command", name: "session", action: name, options: {} };
  const options: Record<string, string | boolean> = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]!;
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === "") throw new Error("Option name is required");
    const next = rest[index + 1];
    if (next !== undefined && !next.startsWith("--")) { options[key] = next; index += 1; }
    else options[key] = true;
  }
  return { kind: "command", name, ...(action === undefined ? {} : { action }), options };
}


export function parseSlashCommand(input: string): ParsedInput { return parseInput(input); }
