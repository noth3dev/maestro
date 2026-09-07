export type CommandKind = "read" | "write" | "critical";
export interface CommandAction { name: string; kind: CommandKind; description: string; }
export interface CommandDefinition { name: string; description: string; actions: CommandAction[]; }

const definitions: CommandDefinition[] = ([
  ["admin", "operator and project administration", [["project-access", "critical"]]],
  ["critical-action", "durable critical action approval", [["approve-and-run", "critical"]]],
  ["task-contract", "Overture task contract lifecycle", [["create", "write"], ["get", "read"], ["amend", "write"], ["select-roles", "write"], ["confirm", "write"], ["launch", "write"]]],
  ["goals", "Goal discovery", [["list", "read"]]],
  ["projects", "Authenticated project discovery", [["list", "read"]]],
  // Emergency stop is the server-authorized fail-safe lifecycle command. It
  // still requires explicit local confirmation; the Control Plane enforces the
  // concertmaster role and records the durable Goal command.
  ["goal", "Goal lifecycle and control", [["create", "write"], ["get", "read"], ["select", "write"], ["transition", "write"], ["pause", "write"], ["resume", "write"], ["stop", "write"], ["emergency-stop", "critical"]]],
  ["budget", "budget and cost state", [["get", "read"], ["forecast", "read"]]],
  ["head", "Head activation and participation", [["activate", "write"], ["sleep", "write"], ["resume", "write"]]],
  ["council", "Head Council deliberation", [["create", "write"], ["get", "read"], ["submit-brief", "write"], ["reveal", "write"], ["decide", "write"]]],
  ["department-plan", "Department Plans", [["create", "write"], ["get", "read"], ["revise", "write"]]],
  ["mission-bundle", "Mission Bundles", [["create", "write"], ["get", "read"]]],
  ["worker", "Scout and Execution Workers", [["spawn", "write"], ["get", "read"], ["list", "read"], ["observe", "write"], ["cancel", "write"], ["accept", "write"], ["certify", "write"], ["certify-conditional", "write"], ["request-help", "write"]]],
  ["workers", "Scout and Execution Workers", [["get", "read"], ["list", "read"]]],
  ["git", "Git integration and lineage", [["status", "read"], ["goal-branch", "write"], ["department-branch", "write"], ["worker-worktree", "write"], ["goal-revision", "write"], ["commit", "critical"], ["integrate", "critical"], ["cleanup", "critical"]]],
  ["environment", "task environments and browsers", [["list", "read"], ["get", "read"], ["create", "write"], ["cleanup", "critical"]]],
  ["device", "enrolled devices and grants", [["list", "read"], ["enroll", "critical"], ["grant", "write"], ["revoke", "critical"], ["dispatch", "write"]]],
  ["discord", "external signals and incidents", [["list", "read"], ["triage", "write"], ["remediate", "critical"], ["close", "write"]]],
  ["metronome-challenges", "Metronome challenge records", [["list", "read"]]],
  ["encore-council", "Encore Council records", [["list", "read"]]],
  ["certifications", "Worker certification records", [["list", "read"]]],
  ["concertmaster-report", "Concertmaster report", [["get", "read"]]],
  ["metronome", "process integrity oversight", [["scan", "write"], ["challenge", "write"], ["correct", "write"], ["safe-pause", "critical"], ["resolve", "write"]]],
  ["encore", "independent improvement review", [["review", "write"]]],
  ["certification", "quality and conditional certification", [["list", "read"], ["certify", "write"]]],
  ["evidence", "evidence bundles and reports", [["list", "read"], ["bundle", "read"], ["report", "read"]]],
  ["approval", "critical action approvals", [["list", "read"], ["approve-and-run", "critical"]]],
  ["events", "durable event stream", [["list", "read"], ["stream", "read"]]],
  ["session", "TUI session lifecycle", [["list", "read"], ["attach", "write"], ["new", "write"], ["retry", "write"]]],
  ["portfolio", "concurrent Goal capacity and priority", [["list", "read"], ["prioritize", "write"], ["pause", "critical"]]],
  ["improvement-digests", "Encore improvement artifacts", [["list", "read"], ["inspect", "read"]]],
] as [string, string, [string, CommandKind][]][]).map(([name, description, actions]) => ({ name, description, actions: actions.map(([action, kind]) => ({ name: action, kind, description: `${name} ${action}` })) }));

export class CommandRegistry {
  constructor(private readonly definitions: readonly CommandDefinition[]) {}
  find(name: string): CommandDefinition | undefined { return this.definitions.find((definition) => definition.name === name); }
  autocomplete(prefix: string): CommandDefinition[] { return this.definitions.filter((definition) => definition.name.startsWith(prefix)); }
  all(): readonly CommandDefinition[] { return this.definitions; }
}

export function createCommandRegistry(): CommandRegistry { return new CommandRegistry(definitions); }
