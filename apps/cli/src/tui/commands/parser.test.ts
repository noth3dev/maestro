import { describe, expect, it } from "vitest";
import { parseInput, parseSlashCommand, tokenize } from "./parser.js";

describe("TUI command parser", () => {
  it("parses slash commands and quoted values without executing them", () => {
    expect(parseInput('/goal get --goal-id "goal 1" --json')).toEqual({
      kind: "command",
      name: "goal",
      action: "get",
      options: { "goal-id": "goal 1", json: true },
    });
  });

  it("treats /retry as the local Control Plane retry command", () => {
    expect(parseSlashCommand("/retry")).toEqual({ kind: "command", name: "session", action: "retry", options: {} });
  });

  it("treats /new as the workspace session reset command", () => {
    expect(parseSlashCommand("/new")).toEqual({ kind: "command", name: "session", action: "new", options: {} });
  });

  it("exposes slash parsing without executing the command", () => {
    expect(parseSlashCommand("/goals list")).toEqual({ kind: "command", name: "goals", action: "list", options: {} });
  });

  it("defaults read-only collection shortcuts to list", () => {
    expect(parseSlashCommand("/goals")).toEqual({ kind: "command", name: "goals", action: "list", options: {} });
    expect(parseSlashCommand("/model")).toEqual({ kind: "command", name: "model", action: "list", options: {} });
    expect(parseSlashCommand("/events")).toEqual({ kind: "command", name: "events", action: "list", options: {} });
  });
  it("parses Flashmob mode shortcuts", () => {
    expect(parseSlashCommand("/flashmob")).toEqual({ kind: "command", name: "flashmob", options: {} });
    expect(parseSlashCommand("/mode flashmob")).toEqual({ kind: "command", name: "mode", action: "flashmob", options: {} });
    expect(parseSlashCommand("/mode maestro")).toEqual({ kind: "command", name: "mode", action: "maestro", options: {} });
  });

  it("keeps implicit current-conversation chat input as natural language beside explicit commands", () => {
    expect(parseInput("현재 Goal 상태를 요약해줘")).toEqual({ kind: "natural-language", text: "현재 Goal 상태를 요약해줘" });
    expect(parseInput("/conversation turn --conversation-id 55555555-5555-4555-8555-555555555555 --text 요약"))
      .toEqual({ kind: "command", name: "conversation", action: "turn", options: { "conversation-id": "55555555-5555-4555-8555-555555555555", text: "요약" } });
  });

  it("rejects an unterminated quote", () => {
    expect(() => tokenize('/goal get --goal-id "unfinished')).toThrow("Unterminated quote");
  });
});
