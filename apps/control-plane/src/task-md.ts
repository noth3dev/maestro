import type { TaskContractSubstance } from "@maestro/contracts";

export class TaskMarkdownError extends Error {}

/** The headings Overture writes in task.md; the first seven are required. */
export const TASK_MD_SECTIONS = {
  outcome: "Outcome",
  successCriteria: "Success criteria",
  repository: "Repository",
  baseRevision: "Base revision",
  dataBoundary: "Data boundary",
  groups: "Groups",
  departments: "Departments",
  userVisibleBehavior: "User-visible behavior",
  scope: "Scope",
  nonGoals: "Non-goals",
  priorities: "Priorities",
  tradeoffs: "Tradeoffs",
  constraints: "Constraints",
  edgeCases: "Edge cases",
  budget: "Budget",
} as const;

const REQUIRED = ["outcome", "successCriteria", "repository", "baseRevision", "dataBoundary", "groups", "departments"] as const;

type SectionKey = keyof typeof TASK_MD_SECTIONS;

function normalizeHeading(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

const headingToKey = new Map<string, SectionKey>(
  (Object.entries(TASK_MD_SECTIONS) as [SectionKey, string][]).map(([key, heading]) => [normalizeHeading(heading), key]),
);

/** Split task.md into its `## Heading` sections; unknown headings are ignored. */
export function readTaskMarkdownSections(markdown: string): Partial<Record<SectionKey, string>> {
  const sections: Partial<Record<SectionKey, string>> = {};
  let current: SectionKey | undefined;
  let inFence = false;
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^```/.test(line)) inFence = !inFence;
    const heading = inFence ? null : /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading !== null) {
      current = headingToKey.get(normalizeHeading(heading[1]!));
      continue;
    }
    if (current !== undefined) sections[current] = `${sections[current] ?? ""}${line}\n`;
  }
  for (const key of Object.keys(sections) as SectionKey[]) sections[key] = sections[key]!.trim();
  return sections;
}

function listItems(text: string | undefined): string[] {
  if (text === undefined || text === "") return [];
  const bullets = text
    .split("\n")
    .map((line) => /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(line)?.[1]?.trim())
    .filter((item): item is string => item !== undefined && item !== "");
  return bullets.length > 0 ? bullets : [text.replace(/\s+/g, " ").trim()];
}

function singleLine(text: string | undefined): string {
  return (text ?? "").replace(/`/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Build a Task Contract substance from task.md. `evidence` names the exact
 * workspace files (revision, path, hash) the contract was drafted from.
 */
export function taskContractFromMarkdown(input: {
  readonly markdown: string;
  readonly projectId: string;
  readonly evidence: readonly string[];
  readonly documents: readonly string[];
}): TaskContractSubstance {
  const sections = readTaskMarkdownSections(input.markdown);
  const missing = REQUIRED.filter((key) => (sections[key] ?? "") === "").map((key) => TASK_MD_SECTIONS[key]);
  if (missing.length > 0) throw new TaskMarkdownError(`task.md is missing: ${missing.join(", ")}`);
  const list = (key: SectionKey, fallback: string[]) => {
    const items = listItems(sections[key]);
    return items.length > 0 ? items : fallback;
  };
  return {
    desiredOutcome: singleLine(sections.outcome),
    userVisibleBehavior: list("userVisibleBehavior", ["The reviewed plan files are visible before confirmation"]),
    successCriteria: list("successCriteria", []),
    liveEvidence: [...input.evidence],
    scope: list("scope", [`Project ${input.projectId}`]),
    nonGoals: list("nonGoals", ["Execution before explicit confirmation and launch"]),
    priorities: list("priorities", ["Preserve the exact reviewed workspace revision", "Keep all effects behind the existing authority path"]),
    acceptableTradeoffs: list("tradeoffs", ["Remain blocked when provider or plan evidence is unavailable"]),
    constraints: list("constraints", ["The Task Contract references the reviewed session workspace revision"]),
    knownEdgeCases: list("edgeCases", ["Workspace changed after review", "Provider unavailable"]),
    project: {
      projectId: input.projectId,
      repository: singleLine(sections.repository),
      immutableBaseRevision: singleLine(sections.baseRevision),
      dataBoundary: singleLine(sections.dataBoundary),
    },
    evidenceReferences: [...input.evidence],
    approvedPreviewReferences: [...input.documents],
    expectedGroups: list("groups", []),
    expectedDepartments: list("departments", []),
    criticalActionExpectations: ["Show the exact effect and require explicit approval"],
    forbiddenEffects: ["Unapproved external effects", "Self-approval"],
    environmentAssumptions: ["PostgreSQL-backed Overture state", "Control Plane remains authoritative"],
    externalServiceAssumptions: ["No external effect before launch"],
    budget: {
      ceiling: singleLine(sections.budget) || "Server-defined",
      reportingExpectations: ["Report durable state and evidence"],
      stoppingConditions: ["Stop on a changed workspace revision, authority failure, or provider uncertainty"],
    },
  };
}
