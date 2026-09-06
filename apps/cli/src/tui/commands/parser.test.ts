import { describe, expect, it } from "vitest";
import { parseInput, tokenize } from "./parser.js";

describe("TUI command parser", () => {
  it("parses slash commands and quoted values without executing them", () => {
    expect(parseInput('/goal get --goal-id "goal 1" --json')).toEqual({ kind: "command", name: "goal", action: "get", options: { "goal-id": "goal 1", json: true } });
  });

  it("keeps natural language as text", () => {
    expect(parseInput("현재 Goal 상태를 요약해줘")).toEqual({ kind: "natural-language", text: "현재 Goal 상태를 요약해줘" });
  });

  it("rejects an unterminated quote", () => {
    expect(() => tokenize('/goal get --goal-id "unfinished')).toThrow("Unterminated quote");
  });
});
