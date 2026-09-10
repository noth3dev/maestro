import { Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";
import type { ConversationTranscriptBlock, UnifiedStreamEntry } from "../conversation-transcript.js";
import { transcriptPaint, tuiTheme } from "../theme.js";

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
  private statusRenderer: () => string[] = () => [];
  private transcriptRenderer: () => readonly ConversationTranscriptBlock[] = () => [];
  private streamRenderer: () => readonly string[] = () => [];
  private orderedStreamRenderer: () => readonly UnifiedStreamEntry[] = () => [];

  setStatusRenderer(renderer: () => string[]): void {
    this.statusRenderer = renderer;
  }
  setTranscriptRenderer(renderer: () => readonly ConversationTranscriptBlock[]): void {
    this.transcriptRenderer = renderer;
  }
  setStreamRenderer(renderer: () => readonly string[]): void {
    this.streamRenderer = renderer;
  }
  setOrderedStreamRenderer(renderer: () => readonly UnifiedStreamEntry[]): void {
    this.orderedStreamRenderer = renderer;
  }

  private renderBlock(block: ConversationTranscriptBlock, width: number): string[] {
    const glyph = block.kind === "error" ? "✗ " : block.kind === "success" ? "✓ " : block.kind === "warning" ? "⚠ " : block.kind === "system" ? "◆ " : "";
    const markdown = new Markdown(`${glyph}${block.heading}\n\n${block.content}`, 0, 0, markdownTheme, { color: transcriptPaint(block.kind) });
    return markdown.render(width);
  }

  render(width: number): string[] {
    const status = this.statusRenderer();
    const orderedStream = this.orderedStreamRenderer();
    if (orderedStream.length > 0) return [...status, ...orderedStream.flatMap((entry) => typeof entry.content === "string" ? entry.content.split("\n") : this.renderBlock(entry.content, width))];
    const blocks = this.transcriptRenderer();
    const stream = this.streamRenderer();
    if (blocks.length === 0) return [...status, ...stream];
    const transcript = blocks.flatMap((block) => this.renderBlock(block, width));
    return [...status, "", ...transcript, ...(stream.length === 0 ? [] : ["", ...stream])];
  }

  invalidate(): void {
    // Transcript blocks are rendered from the current state on every frame.
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
