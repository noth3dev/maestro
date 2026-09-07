import { Editor, type EditorTheme } from "@earendil-works/pi-tui";
import { tuiTheme } from "../theme.js";

export const editorTheme: EditorTheme = {
  borderColor: tuiTheme.primary,
  selectList: {
    selectedPrefix: tuiTheme.primary,
    selectedText: tuiTheme.text,
    description: tuiTheme.muted,
    scrollInfo: tuiTheme.dim,
    noMatch: tuiTheme.warning,
  },
};

export class MaestroEditor extends Editor {
  override render(width: number): string[] {
    const lines = super.render(width);
    // pi-tui 0.85 has no prompt-prefix option. Reserve two padding columns
    // and paint the prompt into them without moving the hardware cursor.
    if (lines.length > 2 && lines[1]!.startsWith("  ")) lines[1] = `${tuiTheme.primary("› ")}${lines[1]!.slice(2)}`;
    return lines;
  }
}

export class SecretEditor extends MaestroEditor {
  hidden = false;

  override render(width: number): string[] {
    const lines = super.render(width);
    if (!this.hidden) return lines;
    // Keep the editor frame and ANSI control sequences intact while replacing
    // only the content rows. The raw key remains in Editor state only until
    // submit and is never added to the normal prompt history.
    return lines.map((line, index) => (index === 0 || index === lines.length - 1 ? line : maskVisibleText(line)));
  }
}

function maskVisibleText(line: string): string {
  let masked = "";
  for (let index = 0; index < line.length;) {
    if (line[index] !== "\u001b") {
      const codePoint = line.codePointAt(index)!;
      masked += "•";
      index += codePoint > 0xffff ? 2 : 1;
      continue;
    }
    const start = index;
    index += 1;
    if (line[index] === "[" || line[index] === "]" || line[index] === "_") {
      index += 1;
      if (line[start + 1] === "[") {
        while (index < line.length && (line.charCodeAt(index) < 0x40 || line.charCodeAt(index) > 0x7e)) index += 1;
        if (index < line.length) index += 1;
      } else {
        while (index < line.length && line[index] !== "\u0007") index += 1;
        if (index < line.length) index += 1;
      }
    } else if (index < line.length) index += 1;
    masked += line.slice(start, index);
  }
  return masked;
}
