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

  it("suggests luthiery registry selection", () => {
    const luthiery = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "luthiery");
    expect(luthiery?.getArgumentCompletions?.("list --reg")).toEqual([expect.objectContaining({ value: "--registry " })]);
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

  it("suggests channel selector and post options", () => {
    const channel = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "channel");
    expect(channel?.getArgumentCompletions?.("read --channel-k")).toEqual([expect.objectContaining({ value: "--channel-kind " })]);
    expect(channel?.getArgumentCompletions?.("post --con")).toEqual([expect.objectContaining({ value: "--content " })]);
  });

  it("suggests the required expected version for every goal lifecycle action", () => {
    const goal = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "goal");
    for (const action of ["pause", "resume", "stop", "emergency-stop"]) {
      expect(goal?.getArgumentCompletions?.(`${action} --expected-v`), action).toEqual([expect.objectContaining({ value: "--expected-version " })]);
    }
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

  it("suggests worker message and git worker-advance actions", () => {
    const items = createCommandAutocompleteItems(createCommandRegistry());
    expect(items.find((item) => item.name === "worker")?.getArgumentCompletions?.("me")).toEqual([expect.objectContaining({ value: "message" })]);
    expect(items.find((item) => item.name === "git")?.getArgumentCompletions?.("worker-")).toEqual(expect.arrayContaining([expect.objectContaining({ value: "worker-advance" })]));
  });

  it("suggests task contract creation options", () => {
    const taskContract = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "task-contract");
    expect(taskContract?.getArgumentCompletions?.("create --su")).toEqual([expect.objectContaining({ value: "--substance-json " })]);
  });

  it("suggests the guided project-index attach option alongside project-id", () => {
    const session = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "session");
    expect(session?.getArgumentCompletions?.("attach --project-i")).toEqual(expect.arrayContaining([expect.objectContaining({ value: "--project-index " })]));
    expect(session?.getArgumentCompletions?.("attach --project-id")).toEqual([expect.objectContaining({ value: "--project-id " })]);
  });
});


  it("does not autocomplete dead Group B entries", () => {
    const items = createCommandAutocompleteItems(createCommandRegistry());
    for (const [name, action] of [["head", "sleep"], ["head", "resume"], ["worker", "request-help"], ["git", "commit"], ["git", "integrate"], ["git", "cleanup"], ["environment", "list"], ["environment", "get"], ["environment", "create"], ["environment", "cleanup"], ["device", "list"], ["device", "enroll"], ["device", "grant"], ["device", "revoke"], ["device", "dispatch"], ["discord", "list"], ["discord", "triage"], ["discord", "remediate"], ["discord", "close"], ["budget", "forecast"], ["approval", "list"], ["portfolio", "list"], ["portfolio", "prioritize"], ["portfolio", "pause"], ["evidence", "report"], ["improvement-digests", "inspect"]] as const) {
      const item = items.find((candidate) => candidate.name === name);
      expect(item?.getArgumentCompletions?.(action) ?? [], `${name} ${action}`).toEqual([]);
    }
  });
