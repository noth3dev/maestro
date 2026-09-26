import React, { type ReactNode } from "react";

/**
 * Minimal Markdown renderer that only ever produces React elements, so file
 * content can never inject HTML. Covers headings, paragraphs, lists, quotes,
 * fenced code, rules, and inline code/bold/italic/links.
 */
export function MarkdownView({ source }: { source: string }) {
  return <div className="md-view">{renderBlocks(source)}</div>;
}

function renderBlocks(source: string): ReactNode[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  const key = () => `b${blocks.length}`;
  while (index < lines.length) {
    const line = lines[index]!;
    const fence = /^```\s*([\w+-]*)\s*$/.exec(line);
    if (fence !== null) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index]!)) body.push(lines[index++]!);
      index += 1;
      blocks.push(
        <pre key={key()} className="md-code" data-language={fence[1] || undefined}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading !== null) {
      const Tag = `h${heading[1]!.length}` as "h1";
      blocks.push(<Tag key={key()}>{renderInline(heading[2]!)}</Tag>);
      index += 1;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push(<hr key={key()} />);
      index += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index]!)) body.push(lines[index++]!.replace(/^>\s?/, ""));
      blocks.push(<blockquote key={key()}>{renderBlocks(body.join("\n"))}</blockquote>);
      continue;
    }
    const listMatch = /^\s*([-*+]|\d+[.)])\s+/.exec(line);
    if (listMatch !== null) {
      const ordered = /\d/.test(listMatch[1]!);
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const item = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[index]!);
        if (item === null || /\d/.test(item[1]!) !== ordered) break;
        const task = /^\[([ xX])\]\s+(.*)$/.exec(item[2]!);
        items.push(
          <li key={items.length}>
            {task === null ? renderInline(item[2]!) : <><input type="checkbox" checked={task[1] !== " "} readOnly disabled /> {renderInline(task[2]!)}</>}
          </li>,
        );
        index += 1;
      }
      blocks.push(ordered ? <ol key={key()}>{items}</ol> : <ul key={key()}>{items}</ul>);
      continue;
    }
    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index]!.trim() !== "" &&
      !/^(#{1,6}\s|```|>|\s*([-*+]|\d+[.)])\s+)/.test(lines[index]!)
    )
      paragraph.push(lines[index++]!);
    blocks.push(<p key={key()}>{renderInline(paragraph.join(" "))}</p>);
  }
  return blocks;
}

const inlinePattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))|((?<![\p{L}\p{N}_.])@[\p{L}\p{N}_-]+)/gu;
const mentionPattern = /(?<![\p{L}\p{N}_.])@[\p{L}\p{N}_-]+/gu;

/** Plain text with `@mentions` highlighted (for messages not rendered as markdown). */
export function renderMentions(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(mentionPattern)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    nodes.push(<span key={`m${start}`} className="mention">{match[0]}</span>);
    last = start + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(inlinePattern)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    const token = match[0];
    const key = `i${nodes.length}`;
    if (match[1] !== undefined) nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (match[2] !== undefined) nodes.push(<strong key={key}>{renderInline(token.slice(2, -2))}</strong>);
    else if (match[3] !== undefined) nodes.push(<em key={key}>{renderInline(token.slice(1, -1))}</em>);
    else if (match[5] !== undefined) nodes.push(<span key={key} className="mention">{token}</span>);
    else {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)!;
      const href = link[2]!;
      nodes.push(
        /^https?:\/\//i.test(href) ? (
          <a key={key} href={href} target="_blank" rel="noreferrer">{link[1]}</a>
        ) : (
          <span key={key} className="md-link-local">{link[1]}</span>
        ),
      );
    }
    last = start + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
