import type { ChannelRead } from "@maestro/api-client";
import { panelLine } from "./common.js";

function authorLabel(message: ChannelRead["messages"][number]): string {
  return `${message.author.kind}:${message.author.id}`;
}

function orderedMessages(messages: ChannelRead["messages"]): ChannelRead["messages"] {
  return [...messages].sort((left, right) => {
    const leftSequence = BigInt(left.sequence);
    const rightSequence = BigInt(right.sequence);
    return leftSequence < rightSequence ? -1 : leftSequence > rightSequence ? 1 : 0;
  });
}

export function renderChannelList(state: readonly ChannelRead[], width: number): string[] {
  if (state.length === 0)
    return [
      "Channels",
      "No Goal-scoped channels are available for this Goal.",
      "Sidebar organization and Encore channels are separate from this Goal-filtered result.",
    ];
  return [
    "Channels",
    ...state.map((read) => panelLine(`• ${read.channel.displayName} · ${read.channel.kind}:${read.channel.scopeId} · ${read.messages.length} messages · ${read.members.length} members`, width)),
  ];
}

export function renderChannelPanel(read: ChannelRead, width: number): string[] {
  const messages = orderedMessages(read.messages);
  if (messages.length === 0) return [read.channel.displayName, "No messages in this channel."];
  return [
    read.channel.displayName,
    ...messages.map((message) => panelLine(`• ${message.sequence} · ${authorLabel(message)} · ${message.content}`, width)),
  ];
}
