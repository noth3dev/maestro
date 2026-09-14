import { describe, expect, it } from "vitest";
import { createCommandRegistry } from "./registry.js";
import { createCommandAutocompleteItems } from "./autocomplete.js";

describe("command argument autocomplete", () => {
  it("suggests actions after a command and typed options after an action", () => {
    const goal = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "goal");
    expect(goal).toBeDefined();
    expect(goal?.getArgumentCompletions?.("se")).toEqual(expect.arrayContaining([expect.objectContaining({ value: "select" })]));
    expect(goal?.getArgumentCompletions?.("select --g")).toEqual([expect.objectContaining({ value: "--goal-id " })]);
  });

  it("keeps the singular model alias discoverable", () => {
    expect(createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "model")).toBeDefined();
  });

  it("suggests report generation options", () => {
    const report = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "concertmaster-report");
    expect(report?.getArgumentCompletions?.("generate --g")).toEqual([expect.objectContaining({ value: "--goal-id " })]);
  });

  it("suggests projection navigation options, including typed prefixes", () => {
    const projection = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "projection");
    expect(projection?.getArgumentCompletions?.("read --g")).toEqual([
      expect.objectContaining({ value: "--goal-id " }),
      expect.objectContaining({ value: "--group-id " }),
    ]);
    expect(projection?.getArgumentCompletions?.("read --dep")).toEqual([expect.objectContaining({ value: "--department-id " })]);
    expect(projection?.getArgumentCompletions?.("read --hea")).toEqual([expect.objectContaining({ value: "--head-id " })]);
  });

  it("suggests the exact model option for conversations", () => {
    const conversation = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "conversation");
    expect(conversation?.getArgumentCompletions?.("create --m")).toEqual([expect.objectContaining({ value: "--model " })]);
  });

  it("suggests full-access and evidence options", () => {
    const items = createCommandAutocompleteItems(createCommandRegistry());
    const capability = items.find((item) => item.name === "capability");
    const evidence = items.find((item) => item.name === "evidence");
    expect(capability?.getArgumentCompletions?.("select-full-access-mode --f")).toEqual([expect.objectContaining({ value: "--full-access-mode " })]);
    expect(evidence?.getArgumentCompletions?.("capture --c")).toEqual(expect.arrayContaining([expect.objectContaining({ value: "--content-base64 " }), expect.objectContaining({ value: "--correlation-id " })]));
  });
});
