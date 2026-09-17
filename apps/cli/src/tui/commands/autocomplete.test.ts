import { CombinedAutocompleteProvider } from "@earendil-works/pi-tui";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { CommandRegistry, createCommandRegistry } from "./registry.js";
import { createCommandAutocompleteItems, createSlashCommandAutocompleteProvider } from "./autocomplete.js";

describe("command argument autocomplete", () => {
  it("derives options from action metadata supplied by the registry", () => {
    const registry = new CommandRegistry([
      {
        name: "custom",
        description: "custom command",
        actions: [{ name: "run", kind: "write", description: "custom run", options: ["--from-metadata"] }],
      },
    ]);
    const custom = createCommandAutocompleteItems(registry).find((item) => item.name === "custom");
    expect(custom?.getArgumentCompletions?.("run --from")).toEqual([expect.objectContaining({ value: "--from-metadata " })]);
  });

  it("suggests actions after a command and typed options after an action", () => {
    const goal = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "goal");
    expect(goal).toBeDefined();
    expect(goal?.getArgumentCompletions?.("se")).toEqual(expect.arrayContaining([expect.objectContaining({ value: "select " })]));
    expect(goal?.getArgumentCompletions?.("select --g")).toEqual([expect.objectContaining({ value: "--goal-id " })]);
  });

  it("does not suggest an ignored project scope for goal reads", () => {
    const goal = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "goal");
    expect(goal?.getArgumentCompletions?.("get --")).toEqual([expect.objectContaining({ value: "--goal-id " })]);
    expect(goal?.getArgumentCompletions?.("get --p")).toEqual([]);
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

  it("suggests the Goal scope for Concertmaster report reads", () => {
    const report = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "concertmaster-report");
    expect(report?.getArgumentCompletions?.("get --")).toEqual([expect.objectContaining({ value: "--goal-id " })]);
    expect(report?.getArgumentCompletions?.("get --g")).toEqual([expect.objectContaining({ value: "--goal-id " })]);
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

  it("suggests the optional event cursor for event reads", () => {
    const events = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "events");
    expect(events?.getArgumentCompletions?.("list --")).toEqual([expect.objectContaining({ value: "--after " })]);
    expect(events?.getArgumentCompletions?.("list --aft")).toEqual([expect.objectContaining({ value: "--after " })]);
  });

  it("suggests the selected Goal scope for budget reads", () => {
    const budget = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "budget");
    expect(budget?.getArgumentCompletions?.("get --")).toEqual([expect.objectContaining({ value: "--goal-id " })]);
    expect(budget?.getArgumentCompletions?.("get --g")).toEqual([expect.objectContaining({ value: "--goal-id " })]);
  });

  it("suggests the required worker identity for worker reads", () => {
    const workers = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "worker");
    expect(workers?.getArgumentCompletions?.("get --")).toEqual([expect.objectContaining({ value: "--worker-id " })]);
    expect(workers?.getArgumentCompletions?.("get --wor")).toEqual([expect.objectContaining({ value: "--worker-id " })]);
  });

  it("suggests the required worker identity for the plural workers get alias", () => {
    const workers = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "workers");
    expect(workers?.getArgumentCompletions?.("get --")).toEqual([expect.objectContaining({ value: "--worker-id " })]);
    expect(workers?.getArgumentCompletions?.("get --wor")).toEqual([expect.objectContaining({ value: "--worker-id " })]);
  });

  it("suggests the required worker identity for worker cancellation", () => {
    const workers = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "worker");
    expect(workers?.getArgumentCompletions?.("cancel --")).toEqual([expect.objectContaining({ value: "--worker-id " })]);
    expect(workers?.getArgumentCompletions?.("cancel --wor")).toEqual([expect.objectContaining({ value: "--worker-id " })]);
  });

  it("suggests the required worker identity for worker observation", () => {
    const workers = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "worker");
    expect(workers?.getArgumentCompletions?.("observe --")).toEqual([expect.objectContaining({ value: "--worker-id " })]);
    expect(workers?.getArgumentCompletions?.("observe --wor")).toEqual([expect.objectContaining({ value: "--worker-id " })]);
  });

  it("suggests the goal scope for worker listing", () => {
    const workers = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "worker");
    expect(workers?.getArgumentCompletions?.("list --")).toEqual([expect.objectContaining({ value: "--goal-id " })]);
    expect(workers?.getArgumentCompletions?.("list --g")).toEqual([expect.objectContaining({ value: "--goal-id " })]);
  });

  it("suggests the Goal scope for the plural workers alias", () => {
    const workers = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "workers");
    expect(workers?.getArgumentCompletions?.("list --")).toEqual([expect.objectContaining({ value: "--goal-id " })]);
    expect(workers?.getArgumentCompletions?.("list --g")).toEqual([expect.objectContaining({ value: "--goal-id " })]);
  });

  it("suggests goal branch scope, branch, and idempotency inputs", () => {
    const git = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "git");
    expect(git?.getArgumentCompletions?.("goal-branch --")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "--goal-id " }),
        expect.objectContaining({ value: "--repository-path " }),
        expect.objectContaining({ value: "--branch-name " }),
        expect.objectContaining({ value: "--base-revision " }),
        expect.objectContaining({ value: "--command-id " }),
      ]),
    );
    expect(git?.getArgumentCompletions?.("goal-branch --goal")).toEqual([expect.objectContaining({ value: "--goal-id " })]);
    expect(git?.getArgumentCompletions?.("goal-branch --command")).toEqual([expect.objectContaining({ value: "--command-id " })]);
    expect(git?.getArgumentCompletions?.("goal-branch --repo")).toEqual([expect.objectContaining({ value: "--repository-path " })]);
  });

  it("suggests the Goal scope for Git status reads", () => {
    const git = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "git");
    expect(git?.getArgumentCompletions?.("status --")).toEqual([expect.objectContaining({ value: "--goal-id " })]);
    expect(git?.getArgumentCompletions?.("status --g")).toEqual([expect.objectContaining({ value: "--goal-id " })]);
  });

  it("suggests the Goal scope for Git revision freezing", () => {
    const git = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "git");
    expect(git?.getArgumentCompletions?.("goal-revision --")).toEqual([expect.objectContaining({ value: "--goal-id " })]);
    expect(git?.getArgumentCompletions?.("goal-revision --g")).toEqual([expect.objectContaining({ value: "--goal-id " })]);
  });

  it("suggests worker worktree identity, path, and idempotency inputs", () => {
    const git = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "git");
    expect(git?.getArgumentCompletions?.("worker-worktree --")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "--worker-id " }),
        expect.objectContaining({ value: "--worktree-path " }),
        expect.objectContaining({ value: "--command-id " }),
      ]),
    );
    expect(git?.getArgumentCompletions?.("worker-worktree --worke")).toEqual([expect.objectContaining({ value: "--worker-id " })]);
  });

  it("suggests department branch identity and idempotency inputs", () => {
    const git = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "git");
    expect(git?.getArgumentCompletions?.("department-branch --")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "--council-id " }),
        expect.objectContaining({ value: "--department-id " }),
        expect.objectContaining({ value: "--command-id " }),
      ]),
    );
    expect(git?.getArgumentCompletions?.("department-branch --coun")).toEqual([expect.objectContaining({ value: "--council-id " })]);
  });

  it("suggests Encore review Goal, payload, and idempotency inputs", () => {
    const encore = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "encore");
    expect(encore?.getArgumentCompletions?.("review --")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "--goal-id " }),
        expect.objectContaining({ value: "--review-json " }),
        expect.objectContaining({ value: "--command-id " }),
      ]),
    );
    expect(encore?.getArgumentCompletions?.("review --rev")).toEqual([expect.objectContaining({ value: "--review-json " })]);
  });

  it("suggests the Goal scope for Metronome scans", () => {
    const metronome = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "metronome");
    expect(metronome?.getArgumentCompletions?.("scan --")).toEqual([expect.objectContaining({ value: "--goal-id " })]);
    expect(metronome?.getArgumentCompletions?.("scan --g")).toEqual([expect.objectContaining({ value: "--goal-id " })]);
  });

  it("suggests Metronome challenge Goal, reason, evidence, and idempotency inputs", () => {
    const metronome = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "metronome");
    expect(metronome?.getArgumentCompletions?.("challenge --")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "--goal-id " }),
        expect.objectContaining({ value: "--reason " }),
        expect.objectContaining({ value: "--finding-ids " }),
        expect.objectContaining({ value: "--evidence-references " }),
        expect.objectContaining({ value: "--command-id " }),
      ]),
    );
    expect(metronome?.getArgumentCompletions?.("challenge --find")).toEqual([expect.objectContaining({ value: "--finding-ids " })]);
  });

  it("suggests the Goal scope for Metronome challenge listing", () => {
    const challenges = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "metronome-challenges");
    expect(challenges?.getArgumentCompletions?.("list --")).toEqual([expect.objectContaining({ value: "--goal-id " })]);
    expect(challenges?.getArgumentCompletions?.("list --g")).toEqual([expect.objectContaining({ value: "--goal-id " })]);
  });

  it("suggests Metronome correction identity and request inputs", () => {
    const metronome = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "metronome");
    expect(metronome?.getArgumentCompletions?.("correct --")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "--challenge-id " }),
        expect.objectContaining({ value: "--correction-request " }),
      ]),
    );
    expect(metronome?.getArgumentCompletions?.("correct --cha")).toEqual([expect.objectContaining({ value: "--challenge-id " })]);
  });

  it("suggests Metronome resolution identity, reason, and idempotency inputs", () => {
    const metronome = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "metronome");
    expect(metronome?.getArgumentCompletions?.("resolve --")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "--challenge-id " }),
        expect.objectContaining({ value: "--reason " }),
        expect.objectContaining({ value: "--command-id " }),
      ]),
    );
    expect(metronome?.getArgumentCompletions?.("resolve --rea")).toEqual([expect.objectContaining({ value: "--reason " })]);
  });

  it("suggests Metronome safe-pause Goal, challenge, and idempotency inputs", () => {
    const metronome = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "metronome");
    expect(metronome?.getArgumentCompletions?.("safe-pause --")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "--goal-id " }),
        expect.objectContaining({ value: "--challenge-id " }),
        expect.objectContaining({ value: "--command-id " }),
      ]),
    );
    expect(metronome?.getArgumentCompletions?.("safe-pause --cha")).toEqual([expect.objectContaining({ value: "--challenge-id " })]);
  });

  it("suggests worker certification identity and payload options", () => {
    const workers = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "worker");
    expect(workers?.getArgumentCompletions?.("certify --")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "--worker-id " }),
        expect.objectContaining({ value: "--certification-json " }),
      ]),
    );
    expect(workers?.getArgumentCompletions?.("certify --cert")).toEqual([expect.objectContaining({ value: "--certification-json " })]);
  });

  it("suggests conditional worker certification inputs", () => {
    const workers = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "worker");
    expect(workers?.getArgumentCompletions?.("certify-conditional --")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "--worker-id " }),
        expect.objectContaining({ value: "--kind " }),
        expect.objectContaining({ value: "--certification-json " }),
      ]),
    );
    expect(workers?.getArgumentCompletions?.("certify-conditional --kin")).toEqual([expect.objectContaining({ value: "--kind " })]);
  });

  it("suggests certification alias identity and payload options", () => {
    const certification = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "certification");
    expect(certification?.getArgumentCompletions?.("certify --")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "--worker-id " }),
        expect.objectContaining({ value: "--certification-json " }),
      ]),
    );
    expect(certification?.getArgumentCompletions?.("certify --cert")).toEqual([expect.objectContaining({ value: "--certification-json " })]);
  });

  it("suggests Goal scope for plural and singular certification reads", () => {
    const autocomplete = createCommandAutocompleteItems(createCommandRegistry());
    const plural = autocomplete.find((item) => item.name === "certifications");
    const singular = autocomplete.find((item) => item.name === "certification");
    expect(plural?.getArgumentCompletions?.("list --")).toEqual([expect.objectContaining({ value: "--goal-id " })]);
    expect(plural?.getArgumentCompletions?.("list --g")).toEqual([expect.objectContaining({ value: "--goal-id " })]);
    expect(singular?.getArgumentCompletions?.("list --")).toEqual([expect.objectContaining({ value: "--goal-id " })]);
    expect(singular?.getArgumentCompletions?.("list --g")).toEqual([expect.objectContaining({ value: "--goal-id " })]);
  });

  it("suggests worker accept identity and reason options", () => {
    const workers = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "worker");
    expect(workers?.getArgumentCompletions?.("accept --")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "--worker-id " }),
        expect.objectContaining({ value: "--reason " }),
      ]),
    );
    expect(workers?.getArgumentCompletions?.("accept --rea")).toEqual([expect.objectContaining({ value: "--reason " })]);
  });

  it("suggests worker spawn inputs and identity options", () => {
    const workers = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "worker");
    expect(workers?.getArgumentCompletions?.("spawn --")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "--council-id " }),
        expect.objectContaining({ value: "--department-id " }),
        expect.objectContaining({ value: "--worker-json " }),
      ]),
    );
    expect(workers?.getArgumentCompletions?.("spawn --wor")).toEqual([expect.objectContaining({ value: "--worker-json " })]);
  });

  it("suggests Mission Bundle inputs and identity options", () => {
    const bundles = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "mission-bundle");
    expect(bundles?.getArgumentCompletions?.("create --")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "--council-id " }),
        expect.objectContaining({ value: "--department-id " }),
        expect.objectContaining({ value: "--item-id " }),
        expect.objectContaining({ value: "--bundle-json " }),
        expect.objectContaining({ value: "--command-id " }),
      ]),
    );
    expect(bundles?.getArgumentCompletions?.("get --")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "--council-id " }),
        expect.objectContaining({ value: "--department-id " }),
        expect.objectContaining({ value: "--plan-version " }),
        expect.objectContaining({ value: "--item-id " }),
      ]),
    );
    expect(bundles?.getArgumentCompletions?.("get --pla")).toEqual([expect.objectContaining({ value: "--plan-version " })]);
  });

  it("suggests Department Plan family inputs and identity options", () => {
    const plans = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "department-plan");
    expect(plans?.getArgumentCompletions?.("create --")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "--council-id " }),
        expect.objectContaining({ value: "--department-id " }),
        expect.objectContaining({ value: "--plan-json " }),
        expect.objectContaining({ value: "--command-id " }),
      ]),
    );
    expect(plans?.getArgumentCompletions?.("get --dep")).toEqual([expect.objectContaining({ value: "--department-id " })]);
    expect(plans?.getArgumentCompletions?.("revise --")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "--council-id " }),
        expect.objectContaining({ value: "--department-id " }),
        expect.objectContaining({ value: "--expected-version " }),
        expect.objectContaining({ value: "--plan-json " }),
        expect.objectContaining({ value: "--reason " }),
        expect.objectContaining({ value: "--command-id " }),
      ]),
    );
    expect(plans?.getArgumentCompletions?.("revise --rea")).toEqual([expect.objectContaining({ value: "--reason " })]);
  });

  it("suggests the Goal scope for improvement digest lists", () => {
    const digests = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "improvement-digests");
    expect(digests?.getArgumentCompletions?.("list --")).toEqual([expect.objectContaining({ value: "--goal-id " })]);
    expect(digests?.getArgumentCompletions?.("list --g")).toEqual([expect.objectContaining({ value: "--goal-id " })]);
  });

  it("suggests the Goal scope for Encore Council lists", () => {
    const councils = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "encore-council");
    expect(councils?.getArgumentCompletions?.("list --")).toEqual([expect.objectContaining({ value: "--goal-id " })]);
    expect(councils?.getArgumentCompletions?.("list --g")).toEqual([expect.objectContaining({ value: "--goal-id " })]);
  });

  it("suggests council decision inputs and identity options", () => {
    const council = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "council");
    expect(council?.getArgumentCompletions?.("decide --")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "--council-id " }),
        expect.objectContaining({ value: "--packet-json " }),
        expect.objectContaining({ value: "--command-id " }),
      ]),
    );
    expect(council?.getArgumentCompletions?.("decide --pac")).toEqual([expect.objectContaining({ value: "--packet-json " })]);
  });

  it("suggests the required council identity for reveal", () => {
    const council = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "council");
    expect(council?.getArgumentCompletions?.("reveal --")).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: "--council-id " }), expect.objectContaining({ value: "--command-id " })]),
    );
    expect(council?.getArgumentCompletions?.("reveal --cou")).toEqual([expect.objectContaining({ value: "--council-id " })]);
  });

  it("suggests council brief submission inputs and identity options", () => {
    const council = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "council");
    expect(council?.getArgumentCompletions?.("submit-brief --")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "--council-id " }),
        expect.objectContaining({ value: "--department-id " }),
        expect.objectContaining({ value: "--brief-json " }),
        expect.objectContaining({ value: "--command-id " }),
      ]),
    );
    expect(council?.getArgumentCompletions?.("submit-brief --dep")).toEqual([expect.objectContaining({ value: "--department-id " })]);
  });

  it("suggests the required council identity for council reads", () => {
    const council = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "council");
    expect(council?.getArgumentCompletions?.("get --")).toEqual([expect.objectContaining({ value: "--council-id " })]);
    expect(council?.getArgumentCompletions?.("get --c")).toEqual([expect.objectContaining({ value: "--council-id " })]);
  });

  it("suggests council creation input and identity options", () => {
    const council = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "council");
    expect(council?.getArgumentCompletions?.("create --")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "--goal-id " }),
        expect.objectContaining({ value: "--council-json " }),
        expect.objectContaining({ value: "--command-id " }),
      ]),
    );
    expect(council?.getArgumentCompletions?.("create --c")).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: "--command-id " }), expect.objectContaining({ value: "--council-json " })]),
    );
  });

  it("suggests head activation input and identity options", () => {
    const head = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "head");
    expect(head?.getArgumentCompletions?.("activate --")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "--goal-id " }),
        expect.objectContaining({ value: "--activation-json " }),
        expect.objectContaining({ value: "--command-id " }),
      ]),
    );
    expect(head?.getArgumentCompletions?.("activate --a")).toEqual([expect.objectContaining({ value: "--activation-json " })]);
  });

  it("suggests the required expected version for every goal lifecycle action", () => {
    const goal = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "goal");
    for (const action of ["pause", "resume", "stop", "emergency-stop"]) {
      expect(goal?.getArgumentCompletions?.(`${action} --expected-v`), action).toEqual([expect.objectContaining({ value: "--expected-version " })]);
    }
  });

  it("does not suggest the unsupported reason option for goal lifecycle actions", () => {
    const goal = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "goal");
    for (const action of ["pause", "resume", "stop", "emergency-stop"]) {
      expect(goal?.getArgumentCompletions?.(`${action} --rea`), action).toEqual([]);
    }
  });

  it("does not suggest an ignored project scope for Goal lifecycle actions", () => {
    const goal = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "goal");
    for (const action of ["transition", "pause", "resume", "stop", "emergency-stop"]) {
      expect(goal?.getArgumentCompletions?.(`${action} --p`), action).toEqual([]);
    }
  });

  it("does not suggest an ignored project scope for goal creation", () => {
    const goal = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "goal");
    expect(goal?.getArgumentCompletions?.("create --")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "--contract-id " }),
        expect.objectContaining({ value: "--command-id " }),
      ]),
    );
    expect(goal?.getArgumentCompletions?.("create --p")).toEqual([]);
  });

  it("suggests the exact model option for conversations", () => {
    const conversation = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "conversation");
    expect(conversation?.getArgumentCompletions?.("create --m")).toEqual([expect.objectContaining({ value: "--model " })]);
  });

  it("does not suggest an ignored project scope for conversation creation", () => {
    const conversation = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "conversation");
    expect(conversation?.getArgumentCompletions?.("create --")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "--goal-id " }),
        expect.objectContaining({ value: "--model " }),
      ]),
    );
    expect(conversation?.getArgumentCompletions?.("create --p")).toEqual([]);
  });

  it("does not suggest an ignored project scope for conversation turns", () => {
    const conversation = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "conversation");
    expect(conversation?.getArgumentCompletions?.("turn --")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "--conversation-id " }),
        expect.objectContaining({ value: "--text " }),
      ]),
    );
    expect(conversation?.getArgumentCompletions?.("turn --p")).toEqual([]);
  });

  it("does not suggest an ignored project scope for conversation reads", () => {
    const conversation = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "conversation");
    expect(conversation?.getArgumentCompletions?.("get --")).toEqual([expect.objectContaining({ value: "--conversation-id " })]);
    expect(conversation?.getArgumentCompletions?.("get --p")).toEqual([]);
  });

  it("does not suggest an ignored project scope for conversation cancellation", () => {
    const conversation = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "conversation");
    expect(conversation?.getArgumentCompletions?.("cancel --")).toEqual([expect.objectContaining({ value: "--conversation-id " })]);
    expect(conversation?.getArgumentCompletions?.("cancel --p")).toEqual([]);
  });

  it("suggests full-access and evidence options", () => {
    const items = createCommandAutocompleteItems(createCommandRegistry());
    const capability = items.find((item) => item.name === "capability");
    const evidence = items.find((item) => item.name === "evidence");
    expect(capability?.getArgumentCompletions?.("select-full-access-mode --f")).toEqual([expect.objectContaining({ value: "--full-access-mode " })]);
    expect(evidence?.getArgumentCompletions?.("capture --c")).toEqual(expect.arrayContaining([expect.objectContaining({ value: "--content-base64 " }), expect.objectContaining({ value: "--correlation-id " })]));
  });

  it("does not suggest an ignored project scope for full-access selection", () => {
    const capability = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "capability");
    expect(capability?.getArgumentCompletions?.("select-full-access-mode --p")).toEqual([]);
  });

  it("does not suggest ignored project scope for evidence actions", () => {
    const evidence = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "evidence");
    for (const action of ["capture", "list", "bundle"]) {
      expect(evidence?.getArgumentCompletions?.(`${action} --p`), action).toEqual([]);
    }
    for (const action of ["list", "bundle"]) {
      expect(evidence?.getArgumentCompletions?.(`${action} --`), action).toEqual([expect.objectContaining({ value: "--goal-id " })]);
    }
  });

  it("suggests worker message and git worker-advance actions", () => {
    const items = createCommandAutocompleteItems(createCommandRegistry());
    expect(items.find((item) => item.name === "worker")?.getArgumentCompletions?.("me")).toEqual([expect.objectContaining({ value: "message " })]);
    expect(items.find((item) => item.name === "git")?.getArgumentCompletions?.("worker-")).toEqual(expect.arrayContaining([expect.objectContaining({ value: "worker-advance " })]));
  });

  it("does not suggest ignored project scope for worker message or Git worker advance", () => {
    const items = createCommandAutocompleteItems(createCommandRegistry());
    const worker = items.find((item) => item.name === "worker");
    const git = items.find((item) => item.name === "git");
    expect(worker?.getArgumentCompletions?.("message --").map((item) => item.value)).toEqual(["--worker-id ", "--message ", "--command-id "]);
    expect(worker?.getArgumentCompletions?.("message --p")).toEqual([]);
    expect(git?.getArgumentCompletions?.("worker-advance --").map((item) => item.value)).toEqual(["--worker-id ", "--message ", "--evidence-references ", "--command-id "]);
    expect(git?.getArgumentCompletions?.("worker-advance --p")).toEqual([]);
  });

  it("suggests the required contract id for task contract reads", () => {
    const taskContract = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "task-contract");
    expect(taskContract?.getArgumentCompletions?.("get --")).toEqual([expect.objectContaining({ value: "--contract-id " })]);
    expect(taskContract?.getArgumentCompletions?.("get --c")).toEqual([expect.objectContaining({ value: "--contract-id " })]);
  });

  it("suggests task contract approval proof options", () => {
    const taskContract = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "task-contract");
    expect(taskContract?.getArgumentCompletions?.("confirm --")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "--contract-id " }),
        expect.objectContaining({ value: "--version " }),
        expect.objectContaining({ value: "--content-hash " }),
      ]),
    );
    expect(taskContract?.getArgumentCompletions?.("confirm --c")).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: "--contract-id " }), expect.objectContaining({ value: "--content-hash " })]),
    );
  });

  it("suggests task contract amendment options", () => {
    const taskContract = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "task-contract");
    expect(taskContract?.getArgumentCompletions?.("amend --")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "--contract-id " }),
        expect.objectContaining({ value: "--expected-version " }),
        expect.objectContaining({ value: "--substance-json " }),
        expect.objectContaining({ value: "--command-id " }),
      ]),
    );
    expect(taskContract?.getArgumentCompletions?.("amend --expected-v")).toEqual([expect.objectContaining({ value: "--expected-version " })]);
  });

  it("suggests task contract role-selection options", () => {
    const taskContract = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "task-contract");
    expect(taskContract?.getArgumentCompletions?.("select-roles --")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "--contract-id " }),
        expect.objectContaining({ value: "--outside-evidence " }),
        expect.objectContaining({ value: "--preview-needed " }),
      ]),
    );
    expect(taskContract?.getArgumentCompletions?.("select-roles --outside")).toEqual([expect.objectContaining({ value: "--outside-evidence " })]);
  });

  it("suggests task contract launch options", () => {
    const taskContract = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "task-contract");
    expect(taskContract?.getArgumentCompletions?.("launch --")).toEqual([expect.objectContaining({ value: "--contract-id " })]);
    expect(taskContract?.getArgumentCompletions?.("launch --c")).toEqual([expect.objectContaining({ value: "--contract-id " })]);
  });

  it("suggests critical-action request options", () => {
    const criticalAction = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "critical-action");
    expect(criticalAction?.getArgumentCompletions?.("request --")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "--goal-id " }),
        expect.objectContaining({ value: "--action " }),
        expect.objectContaining({ value: "--target " }),
        expect.objectContaining({ value: "--policy-version " }),
        expect.objectContaining({ value: "--budget-effect-cents " }),
        expect.objectContaining({ value: "--command-id " }),
      ]),
    );
    expect(criticalAction?.getArgumentCompletions?.("request --pol")).toEqual([expect.objectContaining({ value: "--policy-version " })]);
  });

  it("suggests critical-action approve-and-run options", () => {
    const criticalAction = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "critical-action");
    expect(criticalAction?.getArgumentCompletions?.("approve-and-run --")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "--goal-id " }),
        expect.objectContaining({ value: "--action " }),
        expect.objectContaining({ value: "--target " }),
        expect.objectContaining({ value: "--version " }),
        expect.objectContaining({ value: "--budget-effect-cents " }),
        expect.objectContaining({ value: "--expires-at " }),
        expect.objectContaining({ value: "--command-id " }),
      ]),
    );
    expect(criticalAction?.getArgumentCompletions?.("approve-and-run --exp")).toEqual([expect.objectContaining({ value: "--expires-at " })]);
  });

  it("suggests critical approval alias options", () => {
    const approval = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "approval");
    expect(approval?.getArgumentCompletions?.("approve-and-run --")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "--goal-id " }),
        expect.objectContaining({ value: "--action " }),
        expect.objectContaining({ value: "--target " }),
        expect.objectContaining({ value: "--version " }),
        expect.objectContaining({ value: "--budget-effect-cents " }),
        expect.objectContaining({ value: "--expires-at " }),
        expect.objectContaining({ value: "--command-id " }),
      ]),
    );
    expect(approval?.getArgumentCompletions?.("approve-and-run --ver")).toEqual([expect.objectContaining({ value: "--version " })]);
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

  it("does not autocomplete dead Group B entries", () => {
    const items = createCommandAutocompleteItems(createCommandRegistry());
    for (const [name, action] of [["head", "sleep"], ["head", "resume"], ["worker", "request-help"], ["git", "commit"], ["git", "integrate"], ["git", "cleanup"], ["environment", "list"], ["environment", "get"], ["environment", "create"], ["environment", "cleanup"], ["device", "list"], ["device", "enroll"], ["device", "grant"], ["device", "revoke"], ["device", "dispatch"], ["discord", "list"], ["discord", "triage"], ["discord", "remediate"], ["discord", "close"], ["budget", "forecast"], ["approval", "list"], ["portfolio", "list"], ["portfolio", "prioritize"], ["portfolio", "pause"], ["evidence", "report"], ["improvement-digests", "inspect"]] as const) {
      const item = items.find((candidate) => candidate.name === name);
      expect(item?.getArgumentCompletions?.(action) ?? [], `${name} ${action}`).toEqual([]);
    }
  });

  it("does not autocomplete ignored project scope for admin project access", () => {
    const admin = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "admin");
    expect(admin?.getArgumentCompletions?.("project-access --")).toEqual([
      expect.objectContaining({ value: "--operator-id " }),
      expect.objectContaining({ value: "--roles-json " }),
    ]);
    expect(admin?.getArgumentCompletions?.("project-access --p")).toEqual([]);
  });

  it("does not count option-like words inside quoted values", () => {
    const worker = createCommandAutocompleteItems(createCommandRegistry()).find((command) => command.name === "worker");
    expect(worker).toBeDefined();
    if (worker === undefined || worker.getArgumentCompletions === undefined) throw new Error("expected worker autocomplete");

    for (const quotedValue of [
      '"please use --command-id later"',
      "'please use --command-id later'",
      String.raw`"escaped \"quote\" and \\ path --command-id"`,
      String.raw`"hello	--command-id world"`,
    ]) {
      const suggestions = worker.getArgumentCompletions(`message --worker-id worker-1 --message ${quotedValue} --`);
      expect(suggestions.map((item) => item.value)).toContain("--command-id ");
    }

    const incomplete = worker.getArgumentCompletions(
      'message --worker-id worker-1 --message "please use --command-id later --',
    );
    expect(incomplete).toEqual([]);

    const taskContract = createCommandAutocompleteItems(createCommandRegistry()).find((command) => command.name === "task-contract");
    expect(taskContract?.getArgumentCompletions?.(String.raw`amend --substance-json="{\"text\":\"--expected-version\"}" --`).map((item) => item.value)).toContain(
      "--expected-version ",
    );
  });

  it("does not repeat completed options while completing the next option", () => {
    const goal = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "goal");
    expect(goal?.getArgumentCompletions?.("pause --goal-id goal-1 --")).toEqual([
      expect.objectContaining({ value: "--expected-version " }),
      expect.objectContaining({ value: "--command-id " }),
    ]);
    expect(goal?.getArgumentCompletions?.("pause --goal-id=goal-1 --g")).toEqual([]);
    expect(goal?.getArgumentCompletions?.("pause --goal-id")).toEqual([expect.objectContaining({ value: "--goal-id " })]);

    const taskContract = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "task-contract");
    expect(taskContract?.getArgumentCompletions?.("select-roles --outside-evidence --")).toEqual([
      expect.objectContaining({ value: "--contract-id " }),
      expect.objectContaining({ value: "--preview-needed " }),
    ]);
  });

  it("exposes parser-supported session aliases at the command root", () => {
    const autocomplete = createCommandAutocompleteItems(createCommandRegistry());
    const aliases = autocomplete.filter((item) => item.name === "new" || item.name === "retry");

    expect(aliases.map((item) => item.name)).toEqual(["new", "retry"]);
    expect(aliases.every((item) => item.getArgumentCompletions?.("")?.length === 0)).toBe(true);
    expect(createCommandRegistry().find("new")).toBeUndefined();
    expect(createCommandRegistry().find("retry")).toBeUndefined();
  });

  it("does not duplicate the singular model autocomplete command", () => {
    const autocomplete = createCommandAutocompleteItems(createCommandRegistry());
    const modelCommands = autocomplete.filter((item) => item.name === "model");
    expect(modelCommands).toHaveLength(1);
    expect(modelCommands[0]?.getArgumentCompletions?.("use --")).toEqual([expect.objectContaining({ value: "--model " })]);

    const modelsOnly = new CommandRegistry([
      { name: "models", description: "models", actions: [{ name: "use", kind: "write", description: "use", options: ["--model"] }] },
    ]);
    expect(createCommandAutocompleteItems(modelsOnly).filter((item) => item.name === "model")).toHaveLength(1);
  });

  it("routes explicit Tab at the slash command root before path fallback", async () => {
    const provider = createSlashCommandAutocompleteProvider(
      new CombinedAutocompleteProvider(createCommandAutocompleteItems(createCommandRegistry()), process.cwd()),
    );
    const signal = new AbortController().signal;

    const partial = await provider.getSuggestions(["/go"], 0, 3, { signal, force: true });
    expect(partial?.items.map((item) => item.value)).toContain("goal");

    const root = await provider.getSuggestions(["/"], 0, 1, { signal, force: true });
    expect(root?.items.map((item) => item.value)).toContain("goal");
    expect(root?.items.map((item) => item.value)).not.toContain("/bin/");

    const absolutePath = await provider.getSuggestions(["/tmp"], 0, 4, { signal, force: true });
    expect(absolutePath?.items.map((item) => item.value)).toContain("/tmp/");
    const absoluteDirectory = absolutePath?.items.find((item) => item.value === "/tmp/");
    expect(absoluteDirectory).toBeDefined();
    if (absolutePath === undefined || absoluteDirectory === undefined) throw new Error("expected absolute path completion");
    expect(provider.applyCompletion(["/tmp"], 0, 4, absoluteDirectory, absolutePath.prefix)).toMatchObject({
      lines: ["/tmp/"],
      cursorLine: 0,
      cursorCol: 5,
    });
    expect(provider.applyCompletion(["  /tmp suffix"], 0, 6, absoluteDirectory, absolutePath.prefix)).toMatchObject({
      lines: ["  /tmp/ suffix"],
      cursorLine: 0,
      cursorCol: 7,
    });

    const indented = await provider.getSuggestions(["  /go"], 0, 5, { signal, force: true });
    const goal = indented?.items.find((item) => item.value === "goal");
    expect(goal).toBeDefined();
    expect(indented).toBeDefined();
    if (indented === undefined || goal === undefined) throw new Error("expected indented root command completion");
    expect(provider.applyCompletion(["  /go"], 0, 5, goal, indented.prefix)).toMatchObject({
      lines: ["  /goal "],
      cursorLine: 0,
      cursorCol: 8,
    });
  });

  it("does not intercept nested absolute paths or non-root custom provider applies", () => {
    const calls: Array<{ item: AutocompleteItem; prefix: string }> = [];
    const provider = createSlashCommandAutocompleteProvider({
      getSuggestions: async () => null,
      applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
        calls.push({ item, prefix });
        return { lines, cursorLine, cursorCol };
      },
    });
    const nestedItem = { value: "/tmp/src/", label: "src/" };
    const nestedResult = provider.applyCompletion(["/tmp/src"], 0, 8, nestedItem, "/tmp/src");
    expect(nestedResult.lines).toEqual(["/tmp/src"]);
    expect(calls).toEqual([{ item: nestedItem, prefix: "/tmp/src" }]);

    const nonRootItem = { value: "/tmp/", label: "tmp/" };
    provider.applyCompletion(["/goal --repository-path /tmp"], 0, 28, nonRootItem, "/tmp");
    expect(calls).toEqual([
      { item: nestedItem, prefix: "/tmp/src" },
      { item: nonRootItem, prefix: "/tmp" },
    ]);
  });

  it("gates root command probes before absolute path fallback", async () => {
    const calls: Array<{ lines: string[]; cursorLine: number; cursorCol: number; force: boolean; signal: AbortSignal }> = [];
    const signal = new AbortController().signal;
    const provider = createSlashCommandAutocompleteProvider({
      getSuggestions(lines, cursorLine, cursorCol, options) {
        calls.push({ lines, cursorLine, cursorCol, force: options.force ?? false, signal: options.signal });
        const line = lines[cursorLine]!.slice(0, cursorCol);
        return options.force
          ? Promise.resolve({ items: [{ value: "/tmp/", label: "/tmp/" }], prefix: line })
          : Promise.resolve({
            items: line === "/go" || line === "/" ? [{ value: "goal", label: "goal" }] : [{ value: "department-plan", label: "department-plan" }],
            prefix: line,
          });
      },
      applyCompletion: () => ({ lines: ["unchanged"], cursorLine: 0, cursorCol: 0 }),
    });

    const root = { signal, force: true };
    expect((await provider.getSuggestions(["/go"], 0, 3, root))?.items).toEqual([{ value: "goal", label: "goal" }]);
    expect(calls).toEqual([{ lines: ["/go"], cursorLine: 0, cursorCol: 3, force: false, signal }]);

    calls.length = 0;
    expect((await provider.getSuggestions(["/tmp"], 0, 4, root))?.items).toEqual([{ value: "/tmp/", label: "/tmp/" }]);
    expect(calls).toEqual([
      { lines: ["/tmp"], cursorLine: 0, cursorCol: 4, force: false, signal },
      { lines: ["/tmp"], cursorLine: 0, cursorCol: 4, force: true, signal },
    ]);

    calls.length = 0;
    expect((await provider.getSuggestions(["/g/o"], 0, 4, root))?.items).toEqual([{ value: "/tmp/", label: "/tmp/" }]);
    expect(calls).toEqual([
      { lines: ["/g/o"], cursorLine: 0, cursorCol: 4, force: false, signal },
      { lines: ["/g/o"], cursorLine: 0, cursorCol: 4, force: true, signal },
    ]);

    calls.length = 0;
    expect((await provider.getSuggestions(["/"], 0, 1, root))?.items).toEqual([{ value: "goal", label: "goal" }]);
    expect(calls).toEqual([{ lines: ["/"], cursorLine: 0, cursorCol: 1, force: false, signal }]);
  });

  it("routes explicit Tab in slash arguments to actions and options first", async () => {
    const provider = createSlashCommandAutocompleteProvider(
      new CombinedAutocompleteProvider(createCommandAutocompleteItems(createCommandRegistry()), process.cwd()),
    );
    const signal = new AbortController().signal;

    const actions = await provider.getSuggestions(["/goal "], 0, 6, { signal, force: true });
    expect(actions?.items.map((item) => item.value)).toContain("select ");

    const options = await provider.getSuggestions(["/goal select --"], 0, 16, { signal, force: true });
    expect(options?.items.map((item) => item.value)).toEqual(["--goal-id "]);
  });

  it("falls back to file completion only for path-shaped slash argument values", async () => {
    const provider = createSlashCommandAutocompleteProvider(
      new CombinedAutocompleteProvider(createCommandAutocompleteItems(createCommandRegistry()), process.cwd()),
    );
    const signal = new AbortController().signal;

    const path = await provider.getSuggestions(["/git goal-branch --repository-path ./package"], 0, 44, { signal, force: true });
    expect(path?.items.map((item) => item.value)).toEqual(expect.arrayContaining(["./package.json"]));

    const optionValue = await provider.getSuggestions(["/goal select --goal-id package"], 0, 30, { signal, force: true });
    expect(optionValue).toBeNull();
  });

  it("does not treat non-path tilde values as file completion", async () => {
    const calls: boolean[] = [];
    const provider = createSlashCommandAutocompleteProvider({
      getSuggestions(_lines, _cursorLine, _cursorCol, options) {
        calls.push(options.force ?? false);
        return options.force
          ? Promise.resolve({ items: [{ value: "~/draft", label: "~/draft" }], prefix: "~/draft" })
          : Promise.resolve(null);
      },
      applyCompletion: () => ({ lines: [], cursorLine: 0, cursorCol: 0 }),
    });
    const signal = new AbortController().signal;

    const nonPath = "/conversation turn --text ~draft";
    expect(await provider.getSuggestions([nonPath], 0, nonPath.length, { signal, force: true })).toBeNull();
    expect(calls).toEqual([false]);

    calls.length = 0;
    const homePath = "/conversation turn --text ~/draft";
    expect((await provider.getSuggestions([homePath], 0, homePath.length, { signal, force: true }))?.items).toEqual([
      { value: "~/draft", label: "~/draft" },
    ]);
    expect(calls).toEqual([false, true]);
  });

  it("falls back for active quoted paths but not quoted text values", async () => {
    const calls: boolean[] = [];
    const provider = createSlashCommandAutocompleteProvider({
      getSuggestions(_lines, _cursorLine, _cursorCol, options) {
        calls.push(options.force ?? false);
        return options.force
          ? Promise.resolve({ items: [{ value: "\"./package with\"", label: "\"./package with\"" }], prefix: "\"./package with" })
          : Promise.resolve(null);
      },
      applyCompletion: () => ({ lines: [], cursorLine: 0, cursorCol: 0 }),
    });
    const signal = new AbortController().signal;

    const quotedPath = '/git goal-branch --repository-path "./package with';
    expect(await provider.getSuggestions([quotedPath], 0, quotedPath.length, { signal, force: true })).not.toBeNull();
    expect(calls).toEqual([false, true]);

    calls.length = 0;
    const quotedText = '/conversation turn --text "hello world';
    expect(await provider.getSuggestions([quotedText], 0, quotedText.length, { signal, force: true })).toBeNull();
    expect(calls).toEqual([false]);
  });

  it("falls back for Windows-style path separators", async () => {
    const calls: boolean[] = [];
    const provider = createSlashCommandAutocompleteProvider({
      getSuggestions(_lines, _cursorLine, _cursorCol, options) {
        calls.push(options.force ?? false);
        return options.force
          ? Promise.resolve({ items: [{ value: "path", label: "path" }], prefix: "path" })
          : Promise.resolve(null);
      },
      applyCompletion: () => ({ lines: [], cursorLine: 0, cursorCol: 0 }),
    });
    const signal = new AbortController().signal;
    const windowsPaths = [
      String.raw`/git goal-branch --repository-path C:\repo\src`,
      String.raw`/git goal-branch --repository-path src\file`,
      String.raw`/git goal-branch --repository-path "C:\repo\src`,
    ];

    for (const path of windowsPaths) {
      expect(await provider.getSuggestions([path], 0, path.length, { signal, force: true })).not.toBeNull();
      expect(calls).toEqual([false, true]);
      calls.length = 0;
    }

    const plainText = "/conversation turn --text hello world";
    expect(await provider.getSuggestions([plainText], 0, plainText.length, { signal, force: true })).toBeNull();
    expect(calls).toEqual([false]);
  });

  it("completes slash arguments separated by tabs", async () => {
    const provider = createSlashCommandAutocompleteProvider(
      new CombinedAutocompleteProvider(createCommandAutocompleteItems(createCommandRegistry()), process.cwd()),
    );
    const signal = new AbortController().signal;

    const actionLine = "/goal\t";
    const actions = await provider.getSuggestions([actionLine], 0, actionLine.length, { signal, force: true });
    expect(actions?.items.map((item) => item.value)).toContain("select ");

    const optionLine = "/goal\tselect\t--";
    const options = await provider.getSuggestions([optionLine], 0, optionLine.length, { signal, force: true });
    expect(options?.items.map((item) => item.value)).toEqual(["--goal-id "]);

    const mixedLine = "/goal \tselect\t--";
    const mixed = await provider.getSuggestions([mixedLine], 0, mixedLine.length, { signal, force: true });
    expect(mixed?.items.map((item) => item.value)).toEqual(["--goal-id "]);
  });

  it("normalizes structural tabs only for slash provider lookup", async () => {
    const observed: Array<{ lines: string[]; cursorLine: number; cursorCol: number; force: boolean }> = [];
    const applied: { lines?: string[]; cursorLine?: number; cursorCol?: number } = {};
    const provider = createSlashCommandAutocompleteProvider({
      getSuggestions(lines, cursorLine, cursorCol, options) {
        observed.push({ lines, cursorLine, cursorCol, force: options.force ?? false });
        return Promise.resolve(null);
      },
      applyCompletion(lines, cursorLine, cursorCol) {
        applied.lines = lines;
        applied.cursorLine = cursorLine;
        applied.cursorCol = cursorCol;
        return { lines, cursorLine, cursorCol };
      },
    });
    const signal = new AbortController().signal;
    const line = '/conversation turn --text "hello\tworld';

    await provider.getSuggestions([line], 0, line.length, { signal, force: false });
    expect(observed).toEqual([{ lines: [line], cursorLine: 0, cursorCol: line.length, force: false }]);

    const original = ["/goal\t"];
    provider.applyCompletion(original, 0, original[0]!.length, { value: "select ", label: "select " }, "");
    expect(applied).toEqual({ lines: original, cursorLine: 0, cursorCol: original[0]!.length });
  });

  it("preserves active single-quoted path completion and application", async () => {
    const calls: Array<{ lines: string[]; cursorLine: number; cursorCol: number; force: boolean; signal: AbortSignal }> = [];
    const provider = createSlashCommandAutocompleteProvider({
      getSuggestions(lines, cursorLine, cursorCol, options) {
        calls.push({ lines, cursorLine, cursorCol, force: options.force ?? false, signal: options.signal });
        return options.force
          ? Promise.resolve({
            items: [
              { value: '"./package.json"', label: "package.json" },
              { value: '"apps/"', label: "apps/" },
            ],
            prefix: '"./package with',
          })
          : Promise.resolve(null);
      },
      applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
        const beforePrefix = lines[cursorLine]!.slice(0, cursorCol - prefix.length);
        const afterCursor = lines[cursorLine]!.slice(cursorCol);
        const adjustedAfterCursor = prefix.startsWith('"') && item.value.endsWith('"') && afterCursor.startsWith('"')
          ? afterCursor.slice(1)
          : afterCursor;
        const newLine = beforePrefix + item.value + adjustedAfterCursor;
        const newLines = [...lines];
        newLines[cursorLine] = newLine;
        const cursorOffset = item.label.endsWith("/") ? item.value.length - 1 : item.value.length;
        return { lines: newLines, cursorLine, cursorCol: beforePrefix.length + cursorOffset };
      },
    });
    const signal = new AbortController().signal;
    const line = String.raw`/git goal-branch --repository-path './package with`;

    const suggestions = await provider.getSuggestions([line], 0, line.length, { signal, force: true });
    expect(calls).toEqual([
      { lines: [line], cursorLine: 0, cursorCol: line.length, force: false, signal },
      { lines: [String.raw`/git goal-branch --repository-path "./package with`], cursorLine: 0, cursorCol: line.length, force: true, signal },
    ]);
    expect(suggestions).toMatchObject({
      prefix: "'./package with",
      items: [
        { value: "'./package.json'", label: "package.json" },
        { value: "'apps/'", label: "apps/" },
      ],
    });
    expect(suggestions).toBeDefined();
    if (suggestions === null || suggestions === undefined) throw new Error("expected single-quoted path completion");

    const file = suggestions.items[0]!;
    const directory = suggestions.items[1]!;
    expect(provider.applyCompletion([line], 0, line.length, file, suggestions.prefix)).toMatchObject({
      lines: [String.raw`/git goal-branch --repository-path './package.json'`],
      cursorCol: String.raw`/git goal-branch --repository-path './package.json'`.length,
    });
    const suffixLine = String.raw`/git goal-branch --repository-path './package with' --next`;
    const suffixCursor = suffixLine.indexOf("' --next");
    expect(provider.applyCompletion([suffixLine], 0, suffixCursor, file, suggestions.prefix)).toMatchObject({
      lines: [String.raw`/git goal-branch --repository-path './package.json' --next`],
    });
    const directoryResult = provider.applyCompletion([line], 0, line.length, directory, suggestions.prefix);
    expect(directoryResult.lines).toEqual([String.raw`/git goal-branch --repository-path 'apps/'`]);
    expect(directoryResult.cursorCol).toBe(String.raw`/git goal-branch --repository-path 'apps/`.length);

    calls.length = 0;
    const nonPath = String.raw`/conversation turn --text 'hello world`;
    expect(await provider.getSuggestions([nonPath], 0, nonPath.length, { signal, force: true })).toBeNull();
    expect(calls).toEqual([{ lines: [nonPath], cursorLine: 0, cursorCol: nonPath.length, force: false, signal }]);

    calls.length = 0;
    const attachment = String.raw`/conversation turn --text @'hello world`;
    expect(await provider.getSuggestions([attachment], 0, attachment.length, { signal, force: true })).toBeNull();
    expect(calls).toEqual([{ lines: [attachment], cursorLine: 0, cursorCol: attachment.length, force: false, signal }]);

    calls.length = 0;
    const attachmentPath = String.raw`/conversation turn --text @'./package`;
    expect(await provider.getSuggestions([attachmentPath], 0, attachmentPath.length, { signal, force: true })).toBeNull();
    expect(calls).toEqual([{ lines: [attachmentPath], cursorLine: 0, cursorCol: attachmentPath.length, force: false, signal }]);

    calls.length = 0;
    const equalsAttachment = String.raw`/conversation turn --text=@'./package`;
    expect(await provider.getSuggestions([equalsAttachment], 0, equalsAttachment.length, { signal, force: true })).toBeNull();
    expect(calls).toEqual([{ lines: [equalsAttachment], cursorLine: 0, cursorCol: equalsAttachment.length, force: false, signal }]);

    calls.length = 0;
    const embeddedAt = String.raw`/conversation turn --text x@'./package`;
    expect(await provider.getSuggestions([embeddedAt], 0, embeddedAt.length, { signal, force: true })).not.toBeNull();
    expect(calls).toEqual([
      { lines: [embeddedAt], cursorLine: 0, cursorCol: embeddedAt.length, force: false, signal },
      { lines: [embeddedAt], cursorLine: 0, cursorCol: embeddedAt.length, force: true, signal },
    ]);

    calls.length = 0;
    const ordinaryAttachment = String.raw`/conversation turn --text @./package`;
    expect(await provider.getSuggestions([ordinaryAttachment], 0, ordinaryAttachment.length, { signal, force: true })).not.toBeNull();
    expect(calls).toEqual([
      { lines: [ordinaryAttachment], cursorLine: 0, cursorCol: ordinaryAttachment.length, force: false, signal },
      { lines: [ordinaryAttachment], cursorLine: 0, cursorCol: ordinaryAttachment.length, force: true, signal },
    ]);

    calls.length = 0;
    const embeddedQuoteText = String.raw`/conversation turn --text 'hello "/foo`;
    expect(await provider.getSuggestions([embeddedQuoteText], 0, embeddedQuoteText.length, { signal, force: true })).toBeNull();
    expect(calls).toEqual([{ lines: [embeddedQuoteText], cursorLine: 0, cursorCol: embeddedQuoteText.length, force: false, signal }]);

    calls.length = 0;
    const quotedPathWithDoubleQuote = String.raw`/git goal-branch --repository-path './foo"/bar`;
    expect(await provider.getSuggestions([quotedPathWithDoubleQuote], 0, quotedPathWithDoubleQuote.length, { signal, force: true })).toBeNull();
    expect(calls).toEqual([{ lines: [quotedPathWithDoubleQuote], cursorLine: 0, cursorCol: quotedPathWithDoubleQuote.length, force: false, signal }]);

    calls.length = 0;
    const suffixDoubleQuote = String.raw`/git goal-branch --repository-path './foo"/bar`;
    const suffixDoubleQuoteCursor = suffixDoubleQuote.indexOf('"');
    expect(await provider.getSuggestions([suffixDoubleQuote], 0, suffixDoubleQuoteCursor, { signal, force: true })).toBeNull();
    expect(calls).toEqual([{ lines: [suffixDoubleQuote], cursorLine: 0, cursorCol: suffixDoubleQuoteCursor, force: false, signal }]);

    const applyCalls: Array<{ lines: string[]; cursorLine: number; cursorCol: number; item: { value: string; label: string }; prefix: string }> = [];
    const sentinel = { lines: ["attachment unchanged"], cursorLine: 7, cursorCol: 8 };
    const passthroughProvider = createSlashCommandAutocompleteProvider({
      getSuggestions: async () => null,
      applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
        applyCalls.push({ lines, cursorLine, cursorCol, item, prefix });
        return sentinel;
      },
    });
    const attachmentItem = { value: "'./package.json'", label: "package.json" };
    const attachmentPrefix = "'./pa";
    expect(passthroughProvider.applyCompletion(
      [attachmentPath],
      0,
      attachmentPath.length,
      attachmentItem,
      attachmentPrefix,
    )).toBe(sentinel);
    expect(applyCalls).toEqual([{
      lines: [attachmentPath],
      cursorLine: 0,
      cursorCol: attachmentPath.length,
      item: attachmentItem,
      prefix: attachmentPrefix,
    }]);
  });

  it("passes single-quote apply through outside single-line slash paths", () => {
    const calls: Array<{ lines: string[]; cursorLine: number; cursorCol: number; item: { value: string; label: string }; prefix: string }> = [];
    const sentinel = { lines: ["unchanged"], cursorLine: 3, cursorCol: 4 };
    const provider = createSlashCommandAutocompleteProvider({
      getSuggestions: async () => null,
      applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
        calls.push({ lines, cursorLine, cursorCol, item, prefix });
        return sentinel;
      },
    });
    const item = { value: "'./package.json'", label: "package.json" };
    const multiline = [String.raw`/git goal-branch --repository-path './pa`, "continuation"];
    const attachment = [String.raw`/conversation turn --text @'./pa`];
    const cases = [
      { lines: ["'./pa"], cursorLine: 0, cursorCol: 5 },
      { lines: multiline, cursorLine: 0, cursorCol: multiline[0]!.length },
      { lines: attachment, cursorLine: 0, cursorCol: attachment[0]!.length },
    ];

    for (const current of cases) {
      expect(provider.applyCompletion(current.lines, current.cursorLine, current.cursorCol, item, "'./pa")).toBe(sentinel);
    }
    expect(calls).toEqual(cases.map((current) => ({ ...current, item, prefix: "'./pa" })));
  });

  it("passes multiline slash option apply through unchanged", async () => {
    const getCalls: Array<{ lines: string[]; cursorLine: number; cursorCol: number; force: boolean; signal: AbortSignal }> = [];
    const applyCalls: Array<{ lines: string[]; cursorLine: number; cursorCol: number; item: { value: string; label: string }; prefix: string }> = [];
    const signal = new AbortController().signal;
    const sentinel = { lines: ["unchanged"], cursorLine: 3, cursorCol: 4 };
    const item = { value: "--goal-id ", label: "--goal-id" };
    const provider = createSlashCommandAutocompleteProvider({
      getSuggestions(lines, cursorLine, cursorCol, options) {
        getCalls.push({ lines, cursorLine, cursorCol, force: options.force ?? false, signal: options.signal });
        return Promise.resolve({ items: [item], prefix: "select --g" });
      },
      applyCompletion(lines, cursorLine, cursorCol, completion, prefix) {
        applyCalls.push({ lines, cursorLine, cursorCol, item: completion, prefix });
        return sentinel;
      },
    });
    const lines = ["/goal select --g", "continuation"];
    const cursorCol = lines[0]!.length;
    const suggestions = await provider.getSuggestions(lines, 0, cursorCol, { signal, force: true });

    expect(getCalls).toEqual([{ lines, cursorLine: 0, cursorCol, force: true, signal }]);
    expect(suggestions).toEqual({ items: [item], prefix: "select --g" });
    expect(provider.applyCompletion(lines, 0, cursorCol, item, "select --g")).toBe(sentinel);
    expect(applyCalls).toEqual([{ lines, cursorLine: 0, cursorCol, item, prefix: "select --g" }]);
  });

  it("preserves the action when applying slash option completion", async () => {
    const provider = createSlashCommandAutocompleteProvider(
      new CombinedAutocompleteProvider(createCommandAutocompleteItems(createCommandRegistry()), process.cwd()),
    );
    const signal = new AbortController().signal;
    const cases = [
      ["/goal select --g", "/goal select --goal-id "],
      ["\t/goal select --g", "\t/goal select --goal-id "],
      ["/goal transition --to active --e", "/goal transition --to active --expected-version "],
      ["/goal transition --to=active --e", "/goal transition --to=active --expected-version "],
    ] as const;

    for (const [line, expectedLine] of cases) {
      const suggestions = await provider.getSuggestions([line], 0, line.length, { signal, force: true });
      const option = suggestions?.items.find((item) => item.value === "--goal-id " || item.value === "--expected-version ");
      expect(option).toBeDefined();
      expect(suggestions).toBeDefined();
      if (suggestions === undefined || option === undefined) throw new Error("expected slash option completion");
      expect(provider.applyCompletion([line], 0, line.length, option, suggestions.prefix).lines).toEqual([expectedLine]);
    }
  });

  it("keeps parser-supported leading-whitespace slash commands on command completion", async () => {
    const provider = createSlashCommandAutocompleteProvider(
      new CombinedAutocompleteProvider(createCommandAutocompleteItems(createCommandRegistry()), process.cwd()),
    );
    const signal = new AbortController().signal;

    const root = await provider.getSuggestions(["  /go"], 0, 5, { signal, force: false });
    const goal = root?.items.find((item) => item.value === "goal");
    expect(goal).toBeDefined();
    expect(root).toBeDefined();
    if (root === undefined || goal === undefined) throw new Error("expected root command completion");
    expect(provider.applyCompletion(["  /go"], 0, 5, goal, root.prefix)).toMatchObject({
      lines: ["  /goal "],
      cursorLine: 0,
      cursorCol: 8,
    });

    const actions = await provider.getSuggestions(["\t/goal "], 0, 7, { signal, force: true });
    const select = actions?.items.find((item) => item.value === "select ");
    expect(select).toBeDefined();
    expect(actions).toBeDefined();
    if (actions === undefined || select === undefined) throw new Error("expected action completion");
    expect(provider.applyCompletion(["\t/goal "], 0, 7, select, actions.prefix)).toMatchObject({
      lines: ["\t/goal select "],
      cursorLine: 0,
      cursorCol: 14,
    });

    const observed: Array<{ lines: string[]; cursorLine: number; cursorCol: number; force: boolean }> = [];
    const passthrough = createSlashCommandAutocompleteProvider({
      getSuggestions(lines, cursorLine, cursorCol, options) {
        observed.push({ lines, cursorLine, cursorCol, force: options.force ?? false });
        return Promise.resolve({ items: [{ value: "@apps/", label: "@apps/" }], prefix: "@apps" });
      },
      applyCompletion: () => ({ lines: [], cursorLine: 0, cursorCol: 0 }),
    });
    await passthrough.getSuggestions(["  @apps"], 0, 7, { signal, force: true });
    expect(observed).toEqual([{ lines: ["  @apps"], cursorLine: 0, cursorCol: 7, force: true }]);
  });
});
