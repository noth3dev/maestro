import { describe, expect, it } from "vitest";
import { CommandRegistry, createCommandRegistry } from "./registry.js";
import { createCommandAutocompleteItems } from "./autocomplete.js";

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

  it("suggests goal branch repository and revision inputs", () => {
    const git = createCommandAutocompleteItems(createCommandRegistry()).find((item) => item.name === "git");
    expect(git?.getArgumentCompletions?.("goal-branch --")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "--repository-path " }),
        expect.objectContaining({ value: "--branch-name " }),
        expect.objectContaining({ value: "--base-revision " }),
      ]),
    );
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
