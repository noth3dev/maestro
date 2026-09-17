export type CommandKind = "read" | "write" | "critical";
export interface CommandAction {
  name: string;
  kind: CommandKind;
  description: string;
  /** Action-specific option names used by the TUI autocomplete. */
  options?: readonly string[];
  /** Explicitly marked when the action is executable without parser options. */
  requiresArguments?: boolean;
  /** Explicitly marked when the action needs an attached Goal context. */
  requiresGoal?: boolean;
}
export interface CommandDefinition {
  name: string;
  description: string;
  actions: CommandAction[];
  /** Local shell commands execute directly without a remote action. */
  actionless?: boolean;
}

const actionOptions: Record<string, readonly string[]> = {
  "admin project-access": ["--operator-id", "--project-id", "--roles-json"],
  "critical-action request": ["--goal-id", "--action", "--target", "--policy-version", "--budget-effect-cents", "--command-id"],
  "goal create": ["--project-id", "--contract-id", "--command-id"],
  "task-contract create": ["--contract-id", "--substance-json", "--command-id"],
  "task-contract amend": ["--contract-id", "--expected-version", "--substance-json", "--command-id"],
  "task-contract select-roles": ["--contract-id", "--outside-evidence", "--preview-needed"],
  "task-contract launch": ["--contract-id"],
  "task-contract get": ["--contract-id"],
  "task-contract confirm": ["--contract-id", "--version", "--content-hash"],
  "goal get": ["--goal-id", "--project-id"],
  "luthiery list": ["--registry"],
  "projection read": ["--goal-id", "--department-id", "--group-id", "--head-id"],
  "goal select": ["--goal-id"],
  "goal transition": ["--goal-id", "--project-id", "--expected-version", "--to", "--command-id"],
  "goal pause": ["--goal-id", "--project-id", "--expected-version", "--command-id"],
  "goal resume": ["--goal-id", "--project-id", "--expected-version", "--command-id"],
  "goal stop": ["--goal-id", "--project-id", "--expected-version", "--command-id"],
  "goal emergency-stop": ["--goal-id", "--project-id", "--expected-version", "--command-id"],
  "head activate": ["--goal-id", "--activation-json", "--command-id"],
  "council create": ["--goal-id", "--council-json", "--command-id"],
  "council get": ["--council-id"],
  "council submit-brief": ["--council-id", "--department-id", "--brief-json", "--command-id"],
  "council reveal": ["--council-id", "--command-id"],
  "council decide": ["--council-id", "--packet-json", "--command-id"],
  "department-plan create": ["--council-id", "--department-id", "--plan-json", "--command-id"],
  "department-plan get": ["--council-id", "--department-id"],
  "department-plan revise": ["--council-id", "--department-id", "--expected-version", "--plan-json", "--reason", "--command-id"],
  "mission-bundle create": ["--council-id", "--department-id", "--item-id", "--bundle-json", "--command-id"],
  "mission-bundle get": ["--council-id", "--department-id", "--plan-version", "--item-id"],
  "worker spawn": ["--council-id", "--department-id", "--worker-json", "--command-id"],
  "worker get": ["--worker-id"],
  "worker cancel": ["--worker-id"],
  "worker accept": ["--worker-id", "--reason"],
  "events list": ["--after"],
  "models use": ["--model"],
  "model use": ["--model"],
  "concertmaster-report generate": ["--goal-id", "--command-id"],
  "conversation create": ["--project-id", "--goal-id", "--model"],
  "conversation get": ["--conversation-id", "--project-id"],
  "conversation turn": ["--conversation-id", "--project-id", "--text"],
  "conversation cancel": ["--conversation-id", "--project-id"],
  "channel list": ["--goal-id"],
  "channel read": ["--goal-id", "--channel-kind", "--channel-id"],
  "channel post": ["--goal-id", "--channel-kind", "--channel-id", "--content", "--command-id"],
  "session attach": ["--project-id", "--project-index"],
  "capability select-full-access-mode": ["--goal-id", "--project-id", "--capability-kind", "--session-id", "--full-access-mode"],
  "evidence capture": ["--goal-id", "--project-id", "--correlation-id", "--command-id", "--kind", "--media-type", "--content-base64"],
  "evidence list": ["--goal-id", "--project-id"],
  "evidence bundle": ["--goal-id", "--project-id"],
  "worker message": ["--worker-id", "--project-id", "--message", "--command-id"],
  "git worker-advance": ["--worker-id", "--project-id", "--message", "--evidence-references", "--command-id"],
};

type CommandActionDefinition = [string, CommandKind, (Pick<CommandAction, "requiresArguments" | "requiresGoal">)?];

const definitions: CommandDefinition[] = (
  [
    ["help", "show available commands", [["list", "read"]]],
    ["clear", "clear the visible transcript", []],
    ["exit", "exit the TUI", []],
    ["quit", "exit the TUI", []],
    ["version", "show the Maestro version", []],
    ["copy", "copy the latest transcript line", []],
    ["admin", "operator and project administration", [["project-access", "critical"]]],
    [
      "critical-action",
      "durable critical action approval",
      [
        ["request", "write"],
        ["approve-and-run", "critical"],
      ],
    ],
    [
      "task-contract",
      "Overture task contract lifecycle",
      [
        ["create", "write"],
        ["get", "read"],
        ["amend", "write"],
        ["select-roles", "write"],
        ["confirm", "write"],
        ["launch", "write"],
      ],
    ],
    ["goals", "Goal discovery", [["list", "read"]]],
    ["projects", "Authenticated project discovery", [["list", "read"]]],
    ["capability", "Goal capability access", [["select-full-access-mode", "critical"]]],
    ["projection", "Organization projection navigation", [["read", "read", { requiresArguments: false, requiresGoal: false }]]],
    ["channel", "Department and team channels", [["list", "read"], ["read", "read"], ["post", "write"]]],
    // Emergency stop is the server-authorized fail-safe lifecycle command. It
    // still requires explicit local confirmation; the Control Plane enforces the
    // concertmaster role and records the durable Goal command.
    [
      "goal",
      "Goal lifecycle and control",
      [
        ["create", "write", { requiresArguments: false, requiresGoal: false }],
        ["get", "read"],
        ["select", "write"],
        ["transition", "write"],
        ["pause", "write"],
        ["resume", "write"],
        ["stop", "write"],
        ["emergency-stop", "critical"],
      ],
    ],
    [
      "billing",
      "durable project billing history and totals",
      [["get", "read", { requiresArguments: false, requiresGoal: false }]],
    ],
    [
      "luthiery",
      "durable skill and tool registry",
      [["list", "read", { requiresArguments: false, requiresGoal: false }]],
    ],
    [
      "budget",
      "budget and cost state",
      [["get", "read"]],
    ],
    [
      "head",
      "Head activation and participation",
      [["activate", "write"]],
    ],
    [
      "council",
      "Head Council deliberation",
      [
        ["create", "write"],
        ["get", "read"],
        ["submit-brief", "write"],
        ["reveal", "write"],
        ["decide", "write"],
      ],
    ],
    [
      "department-plan",
      "Department Plans",
      [
        ["create", "write"],
        ["get", "read"],
        ["revise", "write"],
      ],
    ],
    [
      "mission-bundle",
      "Mission Bundles",
      [
        ["create", "write"],
        ["get", "read"],
      ],
    ],
    [
      "worker",
      "Scout and Execution Workers",
      [
        ["spawn", "write"],
        ["get", "read"],
        ["list", "read"],
        ["observe", "write"],
        ["cancel", "write"],
        ["message", "write"],
        ["accept", "write"],
        ["certify", "write"],
        ["certify-conditional", "write"],
      ],
    ],
    [
      "workers",
      "Scout and Execution Workers",
      [
        ["get", "read"],
        ["list", "read"],
      ],
    ],
    [
      "git",
      "Git integration and lineage",
      [
        ["status", "read"],
        ["goal-branch", "write"],
        ["department-branch", "write"],
        ["worker-worktree", "write"],
        ["goal-revision", "write"],
        ["worker-advance", "write"],
      ],
    ],
    ["metronome-challenges", "Metronome challenge records", [["list", "read"]]],
    ["encore-council", "Encore Council records", [["list", "read"]]],
    ["certifications", "Worker certification records", [["list", "read"]]],
    ["concertmaster-report", "Concertmaster report", [["get", "read"], ["generate", "write"]]],
    [
      "metronome",
      "process integrity oversight",
      [
        ["scan", "write"],
        ["challenge", "write"],
        ["correct", "write"],
        ["safe-pause", "critical"],
        ["resolve", "write"],
      ],
    ],
    ["encore", "independent improvement review", [["review", "write"]]],
    [
      "certification",
      "quality and conditional certification",
      [
        ["list", "read"],
        ["certify", "write"],
      ],
    ],
    [
      "evidence",
      "evidence bundles and reports",
      [
        ["list", "read"],
        ["bundle", "read"],
        ["capture", "write"],
      ],
    ],
    [
      "approval",
      "critical action approvals",
      [["approve-and-run", "critical"]],
    ],
    [
      "events",
      "durable event stream",
      [
        ["list", "read"],
        ["stream", "read"],
      ],
    ],
    [
      "login",
      "provider authentication (ChatGPT account login opens in a browser; API-key fallback remains hidden)",
      [
        ["openai-codex", "write"],
        ["openai", "write"],
        ["anthropic", "write"],
      ],
    ],
    [
      "logout",
      "revoke provider credentials",
      [
        ["openai-codex", "write"],
        ["openai", "write"],
        ["anthropic", "write"],
      ],
    ],
    [
      "models",
      "available model catalog",
      [
        ["list", "read"],
        ["use", "write"],
      ],
    ],
    [
      "model",
      "selected provider model",
      [
        ["list", "read"],
        ["use", "write"],
      ],
    ],
    [
      "mode",
      "Maestro or Flashmob execution profile",
      [
        ["list", "read"],
        ["flashmob", "write"],
        ["maestro", "write"],
        ["standard", "write"],
      ],
    ],
    ["flashmob", "toggle the blue Flashmob accent", [["toggle", "write"]]],
    [
      "conversation",
      "native Maestro conversation",
      [
        ["create", "write"],
        ["turn", "write"],
        ["get", "read"],
        ["cancel", "write"],
      ],
    ],
    [
      "session",
      "TUI session lifecycle",
      [
        ["list", "read"],
        ["attach", "write"],
        ["new", "write"],
        ["retry", "write"],
      ],
    ],
    [
      "improvement-digests",
      "Encore improvement artifacts",
      [
        ["list", "read"],
      ],
    ],
  ] as [string, string, CommandActionDefinition[]][]
).map(([name, description, actions]) => ({
  name,
  description,
  actions: actions.map(([action, kind, requirements]) => {
    const options = actionOptions[`${name} ${action}`];
    return {
      name: action,
      kind,
      description: `${name} ${action}`,
      ...(options === undefined ? {} : { options }),
      ...(requirements ?? {}),
    };
  }),
  actionless: actions.length === 0,
}));

export class CommandRegistry {
  constructor(private readonly definitions: readonly CommandDefinition[]) {}
  find(name: string): CommandDefinition | undefined {
    return this.definitions.find((definition) => definition.name === name);
  }
  autocomplete(prefix: string): CommandDefinition[] {
    return this.definitions.filter((definition) => definition.name.startsWith(prefix));
  }
  all(): readonly CommandDefinition[] {
    return this.definitions;
  }
}

export function createCommandRegistry(): CommandRegistry {
  return new CommandRegistry(definitions);
}

export function getZeroArgumentNoGoalActions(registry: CommandRegistry = createCommandRegistry()): readonly { command: string; action: string }[] {
  return registry.all().flatMap((definition) => definition.actions
    .filter((action) => action.kind === "write" && action.requiresArguments === false && action.requiresGoal === false)
    .map((action) => ({ command: definition.name, action: action.name })));
}
