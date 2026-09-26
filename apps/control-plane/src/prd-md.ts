import type { TaskContractSubstance } from "@maestro/contracts";
import { createHeadActivationPlan, HEAD_ACTIVATION_PLAN_VERSION, PERMANENT_DEPARTMENTS, type HeadActivationPlan } from "@maestro/domain";

export class PrdMarkdownError extends Error {}

/** The Overture crew's final deliverable; the Task Contract is drafted from it. */
export const PRD_PATH = "prd.md";

/**
 * `## Heading` names per PRD section (first name is canonical). The first seven
 * are required; phases and slices are not part of the PRD — Department Heads
 * split the work after launch.
 */
export const PRD_SECTIONS = {
  goal: ["Goal", "Outcome"],
  requirements: ["Requirements", "User-visible behavior"],
  successMetrics: ["Success metrics", "Success criteria"],
  repository: ["Repository"],
  baseRevision: ["Base revision"],
  dataBoundary: ["Data boundary"],
  departments: ["Departments"],
  users: ["Users"],
  nonGoals: ["Non-goals"],
  constraints: ["Constraints"],
  risks: ["Risks", "Edge cases"],
  ux: ["UX", "Design"],
  budget: ["Budget"],
} as const;

type SectionKey = keyof typeof PRD_SECTIONS;
const REQUIRED: readonly SectionKey[] = ["goal", "requirements", "successMetrics", "repository", "baseRevision", "dataBoundary", "departments"];

function normalizeHeading(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

const headingToKey = new Map<string, SectionKey>(
  (Object.entries(PRD_SECTIONS) as [SectionKey, readonly string[]][]).flatMap(([key, headings]) => headings.map((heading) => [normalizeHeading(heading), key] as const)),
);

/** Split a PRD into its `## Heading` sections; unknown headings are ignored. */
export function readPrdSections(markdown: string): Partial<Record<SectionKey, string>> {
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
 * Build a Task Contract substance from prd.md. `evidence` names the exact
 * workspace files (revision, path, hash) the contract was drafted from. The
 * PRD's departments are the initial Heads to wake; groups follow from them.
 */
export function taskContractFromPrd(input: {
  readonly markdown: string;
  readonly projectId: string;
  readonly evidence: readonly string[];
  readonly documents: readonly string[];
}): TaskContractSubstance {
  const sections = readPrdSections(input.markdown);
  const missing = REQUIRED.filter((key) => (sections[key] ?? "") === "").map((key) => PRD_SECTIONS[key][0]);
  if (missing.length > 0) throw new PrdMarkdownError(`prd.md is missing: ${missing.join(", ")}`);
  const list = (key: SectionKey, fallback: string[]) => {
    const items = listItems(sections[key]);
    return items.length > 0 ? items : fallback;
  };
  const departments = listItems(sections.departments).map((department) => department.toLowerCase().replace(/\s+department$/, "").replace(/\s+/g, "-"));
  const groups = [...new Set(departments.flatMap((id) => PERMANENT_DEPARTMENTS.filter((department) => department.departmentId === id).map((department) => department.groupId)))];
  if (groups.length === 0) throw new PrdMarkdownError(`prd.md Departments must name at least one of: ${PERMANENT_DEPARTMENTS.map((department) => department.departmentId).join(", ")}`);
  return {
    desiredOutcome: singleLine(sections.goal),
    userVisibleBehavior: list("requirements", []),
    successCriteria: list("successMetrics", []),
    liveEvidence: [...input.evidence],
    scope: [`Project ${input.projectId}`, ...listItems(sections.users).map((user) => `For: ${user}`)],
    nonGoals: list("nonGoals", ["Execution before explicit confirmation and launch"]),
    priorities: ["Preserve the exact reviewed workspace revision", "Keep all effects behind the existing authority path"],
    acceptableTradeoffs: ["Remain blocked when provider or plan evidence is unavailable"],
    constraints: list("constraints", ["The Task Contract references the reviewed session workspace revision"]),
    knownEdgeCases: list("risks", ["Workspace changed after review", "Provider unavailable"]),
    project: {
      projectId: input.projectId,
      repository: singleLine(sections.repository),
      immutableBaseRevision: singleLine(sections.baseRevision),
      dataBoundary: singleLine(sections.dataBoundary),
    },
    // Workspace refs are the review trail (liveEvidence), not durable evidence
    // records; the Council requires evidenceReferences to be records.
    evidenceReferences: [],
    approvedPreviewReferences: [...input.documents],
    expectedGroups: groups,
    expectedDepartments: departments,
    criticalActionExpectations: ["Show the exact effect and require explicit approval"],
    forbiddenEffects: ["Unapproved external effects", "Self-approval"],
    environmentAssumptions: ["PostgreSQL-backed Overture state", "Control Plane remains authoritative"],
    externalServiceAssumptions: ["No external effect before launch"],
    headActivationPlan: headActivationPlanFor(departments, singleLine(sections.goal)),
    budget: {
      ceiling: singleLine(sections.budget) || "Server-defined",
      reportingExpectations: ["Report durable state and evidence"],
      stoppingConditions: ["Stop on a changed workspace revision, authority failure, or provider uncertainty"],
    },
  };
}

/**
 * Every permanent Head wakes for the planning Council. Departments the PRD
 * names are asked for their contribution; the others check whether the Goal
 * needs them and go back to sleep if not.
 */
function headActivationPlanFor(named: readonly string[], goal: string): HeadActivationPlan {
  return createHeadActivationPlan({
    version: HEAD_ACTIVATION_PLAN_VERSION,
    departments: PERMANENT_DEPARTMENTS.map((department) => {
      const inPrd = named.includes(department.departmentId);
      return {
        departmentId: department.departmentId,
        requestedContribution: inPrd
          ? `Plan the ${department.displayName}'s part of: ${goal}`
          : `Check whether this Goal needs the ${department.displayName}: ${goal}`,
        urgency: inPrd ? "named in the PRD" : "not named in the PRD",
        contextScope: ["Task Contract", PRD_PATH],
        budgetEffect: "Planning only; no Workers before Encore approval",
        reason: inPrd ? "The PRD lists this department" : "Every Head reviews the plan; unneeded Heads go back to sleep",
      };
    }),
  });
}
