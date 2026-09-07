import { Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";
import { tuiTheme } from "../theme.js";

const markdownTheme: MarkdownTheme = {
  heading: (text) => tuiTheme.primary(text),
  link: (text) => tuiTheme.teal(text),
  linkUrl: (text) => tuiTheme.muted(text),
  code: (text) => tuiTheme.olive(text),
  codeBlock: (text) => tuiTheme.olive(text),
  codeBlockBorder: (text) => tuiTheme.border(text),
  quote: (text) => tuiTheme.secondary(text),
  quoteBorder: (text) => tuiTheme.borderStrong(text),
  hr: (text) => tuiTheme.border(text),
  listBullet: (text) => tuiTheme.primary(text),
  bold: (text) => tuiTheme.text(text),
  italic: (text) => tuiTheme.secondary(text),
  strikethrough: (text) => tuiTheme.muted(text),
  underline: (text) => tuiTheme.text(text),
};

/** Keeps the conversation area pinned above the input dock and footer. */
export class ConversationViewport {
  private readonly markdown = new Markdown("", 0, 0, markdownTheme);
  private statusRenderer: () => string[] = () => [];
  private transcriptRenderer: () => string = () => "";

  setStatusRenderer(renderer: () => string[]): void {
    this.statusRenderer = renderer;
  }
  setTranscriptRenderer(renderer: () => string): void {
    this.transcriptRenderer = renderer;
  }

  render(width: number): string[] {
    const status = this.statusRenderer();
    const transcript = this.transcriptRenderer();
    if (transcript === "") return status;
    this.markdown.setText(transcript);
    return [...status, "", ...this.markdown.render(width)];
  }

  invalidate(): void {
    this.markdown.invalidate();
  }
}

/** A quiet, terminal-native composer. It uses borders, not a forced surface colour. */
export class FramedComposer {
  constructor(private readonly content: { render(width: number): string[]; invalidate(): void }) {}

  render(width: number): string[] {
    if (width < 2) return this.content.render(width);
    const innerWidth = width - 2;
    const lines = this.content.render(innerWidth);
    const top = tuiTheme.border(`╭${"─".repeat(Math.max(0, innerWidth - 2))}╮`);
    const bottom = tuiTheme.border(`╰${"─".repeat(Math.max(0, innerWidth - 2))}╯`);
    return [top, ...lines.map((line) => `${tuiTheme.border("│")}${line}${tuiTheme.border("│")}`), bottom];
  }

  invalidate(): void {
    this.content.invalidate();
  }
}
